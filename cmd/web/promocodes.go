package main

import (
	"context"
	"crypto/hmac"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"errors"
	"math"
	"net/http"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"
)

type activePromo struct {
	Code     string
	Discount int
	Until    time.Time
}

func (a *app) activePromocode(ctx context.Context, userID string) (*activePromo, error) {
	var promo activePromo
	// Same selection rule and shared activation table as the Telegram bot.
	err := a.db.QueryRow(ctx, `SELECT up.code,p.discount,up.discount_until
FROM user_promocodes up JOIN promocodes p ON p.code=up.code
WHERE up.user_id=$1 AND up.discount_until>NOW()
ORDER BY up.discount_until DESC LIMIT 1`, userID).Scan(&promo.Code, &promo.Discount, &promo.Until)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	if promo.Discount < 1 || promo.Discount > 100 {
		return nil, errors.New("invalid promo discount")
	}
	return &promo, nil
}

type paymentQuote struct {
	UserID     string  `json:"user_id"`
	PlanID     string  `json:"plan_id"`
	Amount     float64 `json:"amount"`
	BaseAmount float64 `json:"base_amount"`
	Discount   int     `json:"discount"`
	PromoCode  string  `json:"promo_code"`
	Expires    int64   `json:"expires"`
	Token      string  `json:"quote,omitempty"`
}

func discountedPlan(p plan, promo *activePromo) plan {
	if promo != nil {
		p.Amount = math.Round(p.Amount*(1-float64(promo.Discount)/100)*100) / 100
	}
	return p
}

func (a *app) quoteMAC(payload string) string {
	mac := hmac.New(sha256.New, a.authSecret)
	mac.Write([]byte("neuravpn-payment-quote-v1\n" + payload))
	return hex.EncodeToString(mac.Sum(nil))
}

func (a *app) makePaymentQuote(userID string, p plan, promo *activePromo) paymentQuote {
	q := paymentQuote{UserID: userID, PlanID: p.ID, Amount: discountedPlan(p, promo).Amount, BaseAmount: p.Amount, Expires: time.Now().Add(10 * time.Minute).Unix()}
	if promo != nil {
		q.PromoCode, q.Discount = promo.Code, promo.Discount
		q.Expires = min(q.Expires, promo.Until.Unix())
	}
	body, _ := json.Marshal(q)
	payload := base64.RawURLEncoding.EncodeToString(body)
	q.Token = payload + "." + a.quoteMAC(payload)
	return q
}

func (a *app) validPaymentQuote(token, userID string, p plan, promo *activePromo) bool {
	if len(token) > 2048 {
		return false
	}
	parts := strings.Split(token, ".")
	if len(parts) != 2 || !hmac.Equal([]byte(parts[1]), []byte(a.quoteMAC(parts[0]))) {
		return false
	}
	body, err := base64.RawURLEncoding.DecodeString(parts[0])
	var q paymentQuote
	if err != nil || json.Unmarshal(body, &q) != nil {
		return false
	}
	code, discount := "", 0
	if promo != nil {
		code, discount = promo.Code, promo.Discount
	}
	return q.UserID == userID && q.PlanID == p.ID && q.Expires > time.Now().Unix() && q.Amount == discountedPlan(p, promo).Amount && q.BaseAmount == p.Amount && q.PromoCode == code && q.Discount == discount
}

func (a *app) handlePaymentQuote(w http.ResponseWriter, r *http.Request, userID string) {
	a.servePaymentQuote(w, r, userID, false)
}

func (a *app) handleApplyPromocode(w http.ResponseWriter, r *http.Request, userID string) {
	a.servePaymentQuote(w, r, userID, true)
}

func (a *app) servePaymentQuote(w http.ResponseWriter, r *http.Request, userID string, apply bool) {
	if r.Method != http.MethodPost {
		writeJSON(w, 405, errResp("method not allowed"))
		return
	}
	if !a.authLimits.allow("promo:"+userID, 30, time.Minute, time.Now()) {
		writeJSON(w, 429, errResp("Слишком много попыток. Подождите минуту."))
		return
	}
	var req struct {
		PlanID string `json:"plan_id"`
		Code   string `json:"code"`
	}
	if readJSON(r, &req) != nil {
		writeJSON(w, 400, errResp("Некорректный запрос"))
		return
	}
	p, ok := a.findPlan(userID, req.PlanID)
	if !ok {
		writeJSON(w, 400, errResp("Тариф не найден"))
		return
	}
	ctx, cancel := context.WithTimeout(r.Context(), 5*time.Second)
	defer cancel()
	message := ""
	if apply {
		code := strings.ToUpper(strings.TrimSpace(req.Code))
		if code == "" || len(code) > 128 {
			writeJSON(w, 400, errResp("Введите промокод (до 128 символов)."))
			return
		}
		var discount int
		var until time.Time
		err := a.db.QueryRow(ctx, `SELECT discount,expires_at FROM promocodes WHERE code=$1 AND expires_at>NOW()`, code).Scan(&discount, &until)
		if errors.Is(err, pgx.ErrNoRows) {
			writeJSON(w, 404, errResp("Промокод не найден или срок его действия истёк."))
			return
		}
		if err != nil || discount < 1 || discount > 100 {
			writeJSON(w, 503, errResp("Не удалось проверить промокод. Повторите попытку."))
			return
		}
		if discount == 100 {
			writeJSON(w, http.StatusUnprocessableEntity, errResp("Промокод найден: скидка 100%. Для бесплатного продления обратитесь в поддержку, платёж не нужен."))
			return
		}
		// Conditional insert is atomic: parallel clicks cannot activate twice.
		tag, err := a.db.Exec(ctx, `INSERT INTO user_promocodes (user_id,code,discount_until)
SELECT $1,code,expires_at FROM promocodes WHERE code=$2 AND expires_at>NOW()
ON CONFLICT (user_id,code) DO NOTHING`, userID, code)
		if err != nil {
			writeJSON(w, 503, errResp("Не удалось применить промокод. Повторите попытку."))
			return
		}
		message = "Промокод активирован."
		if tag.RowsAffected() == 0 {
			var stillActive bool
			_ = a.db.QueryRow(ctx, `SELECT discount_until>NOW() FROM user_promocodes WHERE user_id=$1 AND code=$2`, userID, code).Scan(&stillActive)
			if !stillActive {
				writeJSON(w, 409, errResp("Промокод уже использован или срок его действия истёк."))
				return
			}
			message = "Промокод уже активирован."
		}
	}
	promo, err := a.activePromocode(ctx, userID)
	if err != nil {
		writeJSON(w, 503, errResp("Не удалось проверить скидку. Повторите попытку."))
		return
	}
	if apply && promo == nil {
		writeJSON(w, http.StatusConflict, errResp("Срок действия промокода истёк. Скидка не применена."))
		return
	}
	quote := a.makePaymentQuote(userID, p, promo)
	if quote.Amount < 1 {
		writeJSON(w, http.StatusUnprocessableEntity, errResp("Действует полная скидка. Для бесплатного продления обратитесь в поддержку, платёж не нужен."))
		return
	}
	if apply && promo != nil && promo.Code != strings.ToUpper(strings.TrimSpace(req.Code)) {
		message += " Для оплаты действует ранее активированный промокод " + promo.Code + ". Скидки не суммируются."
	}
	writeJSON(w, 200, map[string]any{"quote": quote, "message": message})
}
