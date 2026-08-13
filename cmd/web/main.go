package main

import (
	"bytes"
	"context"
	"crypto/hmac"
	"crypto/rand"
	"crypto/sha256"
	"crypto/subtle"
	"crypto/tls"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"html"
	"io"
	"log"
	"math"
	"mime"
	"net"
	"net/http"
	"net/http/cookiejar"
	"net/mail"
	"net/smtp"
	"net/url"
	"os"
	"sort"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
)

type app struct {
	db             *pgxpool.Pool
	authSecret     []byte
	corsOrigin     string
	publicBase     string
	subBase        string
	mergedBase     string
	mergedSecret   string
	yooShopID      string
	yooSecret      string
	adminIDs       map[string]bool
	botToken       string
	webLogChatID   string
	webLogMu       sync.Mutex
	webLogs        map[string]*webLogSession
	botUsername    string
	mergedXray     *webXrayClient
	mergedInbounds []int
}

type webLogSession struct {
	MsgID    int
	Start    time.Time
	Last     time.Time
	UserID   string
	Username string
	Email    string
	IP       string
	Source   string
	Actions  []string
	Sending  bool
	Dirty    bool
}

type plan struct {
	ID     string  `json:"id"`
	Title  string  `json:"title"`
	Amount float64 `json:"amount"`
	Days   int     `json:"days"`
}

type trafficPack struct {
	ID     string  `json:"id"`
	Title  string  `json:"title"`
	GB     int64   `json:"gb"`
	Amount float64 `json:"amount"`
}

var plans = []plan{
	{ID: "30d", Title: "30 дней", Amount: 149, Days: 30},
	{ID: "60d", Title: "60 дней", Amount: 289, Days: 60},
	{ID: "90d", Title: "90 дней", Amount: 419, Days: 90},
	{ID: "365d", Title: "365 дней", Amount: 1499, Days: 365},
}

var testPlan = plan{ID: "test_1d", Title: "Тест 1 день", Amount: 1, Days: 1}

var trafficPacks = []trafficPack{
	{ID: "traffic_50gb", Title: "50 ГБ", GB: 50, Amount: 119},
	{ID: "traffic_150gb", Title: "150 ГБ", GB: 150, Amount: 349},
	{ID: "traffic_250gb", Title: "250 ГБ", GB: 250, Amount: 549},
}

var testTrafficPack = trafficPack{ID: "traffic_test_5gb", Title: "Тест 5 ГБ", GB: 5, Amount: 1}

const (
	gibBytes               int64 = 1024 * 1024 * 1024
	mergedBaseTrafficBytes int64 = 10 * gibBytes
)

func main() {
	dsn := strings.TrimSpace(os.Getenv("DB_DSN"))
	if dsn == "" {
		log.Fatal("DB_DSN is required")
	}
	secret := strings.TrimSpace(os.Getenv("WEB_AUTH_SECRET"))
	if secret == "" {
		secret = strings.TrimSpace(os.Getenv("TG_BOT_TOKEN"))
	}
	if secret == "" {
		log.Fatal("WEB_AUTH_SECRET or TG_BOT_TOKEN is required")
	}

	ctx, cancel := context.WithTimeout(context.Background(), 8*time.Second)
	defer cancel()
	db, err := pgxpool.New(ctx, dsn)
	if err != nil {
		log.Fatalf("postgres connect failed: %v", err)
	}
	defer db.Close()

	a := &app{
		db:           db,
		authSecret:   []byte(secret),
		corsOrigin:   strings.TrimSpace(os.Getenv("WEB_CORS_ORIGIN")),
		publicBase:   strings.TrimRight(strings.TrimSpace(os.Getenv("WEB_PUBLIC_BASE_URL")), "/"),
		subBase:      strings.TrimRight(strings.TrimSpace(os.Getenv("SUB_BASE_URL")), "/"),
		mergedBase:   strings.TrimRight(strings.TrimSpace(os.Getenv("MERGED_SUB_PUBLIC_BASE_URL")), "/"),
		mergedSecret: strings.TrimSpace(os.Getenv("MERGED_SUB_SECRET")),
		yooShopID:    strings.TrimSpace(os.Getenv("YOOKASSA_STORE_ID")),
		yooSecret:    strings.TrimSpace(os.Getenv("YOOKASSA_API_KEY")),
		adminIDs:     parseAdminIDs(os.Getenv("ADMIN_IDS")),
		botToken:     strings.TrimSpace(os.Getenv("TG_BOT_TOKEN")),
		webLogChatID: strings.TrimSpace(os.Getenv("WEB_LOG_CHAT_ID")),
		webLogs:      make(map[string]*webLogSession),
		botUsername:  strings.TrimPrefix(strings.TrimSpace(envOrDefault("TG_BOT_USERNAME", "neuravpn_bot")), "@"),
	}
	a.mergedXray, a.mergedInbounds = newWebMergedXrayFromEnv()
	if err := a.initSchema(context.Background()); err != nil {
		log.Fatalf("schema init failed: %v", err)
	}

	mux := http.NewServeMux()
	mux.HandleFunc("/api/auth/request-code", a.handleRequestCode)
	mux.HandleFunc("/api/auth/verify-code", a.handleVerifyCode)
	mux.HandleFunc("/api/auth/telegram-login", a.handleTelegramLoginWidgetAuth)
	mux.HandleFunc("/api/auth/telegram/start", a.handleTelegramLoginStart)
	mux.HandleFunc("/api/auth/telegram/check", a.handleTelegramLoginCheck)
	mux.HandleFunc("/api/auth/telegram-webapp", a.handleTelegramWebAppAuth)
	mux.HandleFunc("/api/auth/logout", a.handleLogout)
	mux.HandleFunc("/api/me", a.requireAuth(a.handleMe))
	mux.HandleFunc("/api/plans", a.requireAuth(a.handlePlans))
	mux.HandleFunc("/api/payments/create", a.requireAuth(a.handleCreatePayment))
	mux.HandleFunc("/api/traffic/packs", a.requireAuth(a.handleTrafficPacks))
	mux.HandleFunc("/api/traffic/create", a.requireAuth(a.handleCreateTrafficPayment))
	mux.HandleFunc("/api/traffic/refresh", a.requireAuth(a.handleRefreshTraffic))
	mux.HandleFunc("/api/autopay/enable", a.requireAuth(a.handleEnableAutopay))
	mux.HandleFunc("/api/autopay/disable", a.requireAuth(a.handleDisableAutopay))
	mux.HandleFunc("/api/autopay/detach", a.requireAuth(a.handleDetachAutopay))
	mux.HandleFunc("/api/log/ui", a.requireAuth(a.handleUILog))
	mux.HandleFunc("/healthz", func(w http.ResponseWriter, r *http.Request) { writeJSON(w, http.StatusOK, map[string]any{"ok": true}) })

	port := strings.TrimSpace(os.Getenv("WEB_PORT"))
	if port == "" {
		port = "8090"
	}
	log.Printf("neuravpn web API listening on :%s", port)
	if err := http.ListenAndServe(":"+port, a.withCORS(mux)); err != nil {
		log.Fatal(err)
	}
}

func (a *app) initSchema(ctx context.Context) error {
	_, err := a.db.Exec(ctx, `
CREATE TABLE IF NOT EXISTS email_login_codes (
    id BIGSERIAL PRIMARY KEY,
    email TEXT NOT NULL,
    code_hash TEXT NOT NULL,
    attempts INT NOT NULL DEFAULT 0,
    expires_at TIMESTAMPTZ NOT NULL,
    used_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_email_login_codes_email_created_at ON email_login_codes (lower(email), created_at DESC);
CREATE TABLE IF NOT EXISTS web_sessions (
    token_hash TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id),
    expires_at TIMESTAMPTZ NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_web_sessions_user_id ON web_sessions(user_id);
CREATE INDEX IF NOT EXISTS idx_web_sessions_expires_at ON web_sessions(expires_at);
CREATE TABLE IF NOT EXISTS web_login_tokens (
    token_hash TEXT PRIMARY KEY,
    user_id TEXT REFERENCES users(id),
    expires_at TIMESTAMPTZ NOT NULL,
    confirmed_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_web_login_tokens_expires_at ON web_login_tokens(expires_at);
CREATE TABLE IF NOT EXISTS merged_traffic (
    user_id TEXT PRIMARY KEY,
    month TEXT NOT NULL,
    extra_allocated_bytes BIGINT NOT NULL DEFAULT 0,
    last_synced_used_bytes BIGINT NOT NULL DEFAULT 0,
    last_synced_limit_bytes BIGINT NOT NULL DEFAULT 0,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
ALTER TABLE merged_traffic ADD COLUMN IF NOT EXISTS last_synced_limit_bytes BIGINT NOT NULL DEFAULT 0;
DELETE FROM email_login_codes WHERE expires_at < NOW() - INTERVAL '1 day';
DELETE FROM web_sessions WHERE expires_at < NOW();
DELETE FROM web_login_tokens WHERE expires_at < NOW() - INTERVAL '1 day';
`)
	return err
}

func (a *app) handleRequestCode(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		writeJSON(w, http.StatusMethodNotAllowed, errResp("method not allowed"))
		return
	}
	var req struct {
		Email string `json:"email"`
	}
	if err := readJSON(r, &req); err != nil {
		writeJSON(w, http.StatusBadRequest, errResp("bad json"))
		return
	}
	email, err := normalizeEmail(req.Email)
	if err != nil {
		writeJSON(w, http.StatusBadRequest, errResp("некорректный email"))
		return
	}
	accounts, err := a.usersByEmail(r.Context(), email)
	if err != nil {
		log.Printf("users by email failed: %v", err)
		writeJSON(w, http.StatusInternalServerError, errResp("ошибка поиска аккаунта"))
		return
	}
	if len(accounts) == 0 {
		writeJSON(w, http.StatusNotFound, map[string]any{
			"error":      "аккаунт с этим email не найден",
			"code":       "account_not_found",
			"can_create": true,
		})
		return
	}

	code := randomDigits(6)
	hash := a.codeHash(email, code)
	_, err = a.db.Exec(r.Context(), `INSERT INTO email_login_codes (email, code_hash, expires_at) VALUES ($1, $2, NOW() + INTERVAL '10 minutes')`, email, hash)
	if err != nil {
		log.Printf("request code insert failed: %v", err)
		writeJSON(w, http.StatusInternalServerError, errResp("не удалось создать код"))
		return
	}

	if err := sendLoginCode(email, code); err != nil {
		log.Printf("email send failed email=%s code=%s err=%v", email, code, err)
	} else {
		log.Printf("email login code sent email=%s", email)
	}
	logUserID := ""
	if len(accounts) == 1 {
		logUserID = accounts[0].ID
	}
	a.sendWebLog(r, logUserID, email, "запросил код входа", "")
	writeJSON(w, http.StatusOK, map[string]any{"ok": true})
}

func (a *app) handleVerifyCode(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		writeJSON(w, http.StatusMethodNotAllowed, errResp("method not allowed"))
		return
	}
	var req struct {
		Email  string `json:"email"`
		Code   string `json:"code"`
		UserID string `json:"user_id"`
	}
	if err := readJSON(r, &req); err != nil {
		writeJSON(w, http.StatusBadRequest, errResp("bad json"))
		return
	}
	email, err := normalizeEmail(req.Email)
	if err != nil {
		writeJSON(w, http.StatusBadRequest, errResp("некорректный email"))
		return
	}
	code := strings.TrimSpace(req.Code)
	if len(code) < 4 || len(code) > 8 {
		writeJSON(w, http.StatusBadRequest, errResp("некорректный код"))
		return
	}

	var id int64
	var codeHash string
	var attempts int
	err = a.db.QueryRow(r.Context(), `
SELECT id, code_hash, attempts FROM email_login_codes
WHERE lower(email)=lower($1) AND used_at IS NULL AND expires_at > NOW()
ORDER BY created_at DESC LIMIT 1`, email).Scan(&id, &codeHash, &attempts)
	if err != nil {
		writeJSON(w, http.StatusUnauthorized, errResp("код истёк или не найден"))
		return
	}
	if attempts >= 5 {
		writeJSON(w, http.StatusTooManyRequests, errResp("слишком много попыток"))
		return
	}
	if subtle.ConstantTimeCompare([]byte(codeHash), []byte(a.codeHash(email, code))) != 1 {
		_, _ = a.db.Exec(r.Context(), `UPDATE email_login_codes SET attempts = attempts + 1 WHERE id=$1`, id)
		writeJSON(w, http.StatusUnauthorized, errResp("неверный код"))
		return
	}

	accounts, err := a.usersByEmail(r.Context(), email)
	if err != nil {
		log.Printf("users by email failed: %v", err)
		writeJSON(w, http.StatusInternalServerError, errResp("ошибка поиска аккаунта"))
		return
	}
	if len(accounts) == 0 {
		writeJSON(w, http.StatusNotFound, errResp("аккаунт с этим email не найден"))
		return
	}
	userID := strings.TrimSpace(req.UserID)
	if len(accounts) > 1 && userID == "" {
		writeJSON(w, http.StatusOK, map[string]any{"multiple": true, "accounts": publicAccounts(accounts)})
		return
	}
	if userID == "" {
		userID = accounts[0].ID
	}
	if !accountContains(accounts, userID) {
		writeJSON(w, http.StatusForbidden, errResp("аккаунт не относится к этому email"))
		return
	}

	_, _ = a.db.Exec(r.Context(), `UPDATE email_login_codes SET used_at=NOW() WHERE id=$1`, id)
	token := randomToken(32)
	expires := time.Now().Add(30 * 24 * time.Hour)
	_, err = a.db.Exec(r.Context(), `INSERT INTO web_sessions (token_hash, user_id, expires_at) VALUES ($1,$2,$3)`, sessionHash(token), userID, expires)
	if err != nil {
		log.Printf("session insert failed: %v", err)
		writeJSON(w, http.StatusInternalServerError, errResp("не удалось создать сессию"))
		return
	}
	setSessionCookie(w, token, expires)
	a.sendWebLog(r, userID, email, "вошёл в личный кабинет", "")
	writeJSON(w, http.StatusOK, map[string]any{"ok": true})
}

func (a *app) handleTelegramLoginStart(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		writeJSON(w, http.StatusMethodNotAllowed, errResp("method not allowed"))
		return
	}
	token := randomToken(32)
	expires := time.Now().Add(5 * time.Minute)
	_, err := a.db.Exec(r.Context(), `
INSERT INTO web_login_tokens (token_hash, expires_at)
VALUES ($1, $2)
ON CONFLICT (token_hash) DO UPDATE SET user_id=NULL, confirmed_at=NULL, expires_at=EXCLUDED.expires_at, created_at=NOW()`,
		sessionHash(token), expires)
	if err != nil {
		log.Printf("telegram login token insert failed: %v", err)
		writeJSON(w, http.StatusInternalServerError, errResp("не удалось создать вход через Telegram"))
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{
		"ok":         true,
		"token":      token,
		"bot_url":    fmt.Sprintf("https://t.me/%s?start=web_login_%s", a.botUsername, url.QueryEscape(token)),
		"expires_in": 300,
	})
}

func (a *app) handleTelegramLoginCheck(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		writeJSON(w, http.StatusMethodNotAllowed, errResp("method not allowed"))
		return
	}
	var req struct {
		Token string `json:"token"`
	}
	if err := readJSON(r, &req); err != nil {
		writeJSON(w, http.StatusBadRequest, errResp("bad json"))
		return
	}
	token := strings.TrimSpace(req.Token)
	if len(token) < 24 {
		writeJSON(w, http.StatusBadRequest, errResp("некорректный токен"))
		return
	}
	var userID string
	var confirmed bool
	err := a.db.QueryRow(r.Context(), `
SELECT COALESCE(user_id, ''), confirmed_at IS NOT NULL
FROM web_login_tokens
WHERE token_hash=$1 AND expires_at > NOW()`, sessionHash(token)).Scan(&userID, &confirmed)
	if err != nil {
		writeJSON(w, http.StatusGone, errResp("вход через Telegram истёк"))
		return
	}
	if userID == "" || !confirmed {
		writeJSON(w, http.StatusOK, map[string]any{"ok": true, "confirmed": false})
		return
	}
	sessionToken := randomToken(32)
	sessionExpires := time.Now().Add(30 * 24 * time.Hour)
	_, err = a.db.Exec(r.Context(), `INSERT INTO web_sessions (token_hash, user_id, expires_at) VALUES ($1,$2,$3)`,
		sessionHash(sessionToken), userID, sessionExpires)
	if err != nil {
		log.Printf("telegram session insert failed: %v", err)
		writeJSON(w, http.StatusInternalServerError, errResp("не удалось создать сессию"))
		return
	}
	setSessionCookie(w, sessionToken, sessionExpires)
	a.sendWebLog(r, userID, "", "вошёл через Telegram", "")
	writeJSON(w, http.StatusOK, map[string]any{"ok": true, "confirmed": true})
}

func (a *app) handleTelegramLoginWidgetAuth(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		writeJSON(w, http.StatusMethodNotAllowed, errResp("method not allowed"))
		return
	}
	if a.botToken == "" {
		writeJSON(w, http.StatusInternalServerError, errResp("Telegram Login Widget не настроен"))
		return
	}
	tgUser, err := a.validateTelegramLoginWidgetData(r)
	if err != nil {
		writeJSON(w, http.StatusUnauthorized, errResp("Telegram вход не подтверждён"))
		return
	}
	if err := a.ensureWebUser(r.Context(), tgUser.ID); err != nil {
		log.Printf("telegram login widget ensure user failed: %v", err)
		writeJSON(w, http.StatusInternalServerError, errResp("не удалось подготовить аккаунт"))
		return
	}
	token := randomToken(32)
	expires := time.Now().Add(30 * 24 * time.Hour)
	_, err = a.db.Exec(r.Context(), `INSERT INTO web_sessions (token_hash, user_id, expires_at) VALUES ($1,$2,$3)`,
		sessionHash(token), tgUser.ID, expires)
	if err != nil {
		log.Printf("telegram login widget session insert failed: %v", err)
		writeJSON(w, http.StatusInternalServerError, errResp("не удалось создать сессию"))
		return
	}
	setSessionCookie(w, token, expires)
	a.sendWebLogWithUsername(r, tgUser.ID, tgUser.Username, "", "вошёл через Telegram", "")
	writeJSON(w, http.StatusOK, map[string]any{"ok": true})
}

func (a *app) handleTelegramWebAppAuth(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		writeJSON(w, http.StatusMethodNotAllowed, errResp("method not allowed"))
		return
	}
	if a.botToken == "" {
		writeJSON(w, http.StatusInternalServerError, errResp("Telegram Mini App не настроен"))
		return
	}
	var req struct {
		InitData string `json:"init_data"`
	}
	if err := readJSON(r, &req); err != nil {
		writeJSON(w, http.StatusBadRequest, errResp("bad json"))
		return
	}
	tgUser, err := a.validateTelegramWebAppInitData(req.InitData)
	if err != nil {
		writeJSON(w, http.StatusUnauthorized, errResp("Telegram вход не подтверждён"))
		return
	}
	if err := a.ensureWebUser(r.Context(), tgUser.ID); err != nil {
		log.Printf("webapp ensure user failed: %v", err)
		writeJSON(w, http.StatusInternalServerError, errResp("не удалось подготовить аккаунт"))
		return
	}
	token := randomToken(32)
	expires := time.Now().Add(30 * 24 * time.Hour)
	_, err = a.db.Exec(r.Context(), `INSERT INTO web_sessions (token_hash, user_id, expires_at) VALUES ($1,$2,$3)`,
		sessionHash(token), tgUser.ID, expires)
	if err != nil {
		log.Printf("webapp session insert failed: %v", err)
		writeJSON(w, http.StatusInternalServerError, errResp("не удалось создать сессию"))
		return
	}
	setSessionCookie(w, token, expires)
	a.sendWebLogWithSource(r, tgUser.ID, tgUser.Username, "", "Профиль MiniApp", "", "miniapp")
	writeJSON(w, http.StatusOK, map[string]any{"ok": true})
}

func (a *app) handleLogout(w http.ResponseWriter, r *http.Request) {
	userID := ""
	if cookie, err := r.Cookie("nvpn_session"); err == nil {
		userID, _ = a.sessionUserID(r.Context(), cookie.Value)
		_, _ = a.db.Exec(r.Context(), `DELETE FROM web_sessions WHERE token_hash=$1`, sessionHash(cookie.Value))
	}
	clearSessionCookie(w)
	if userID != "" {
		a.sendWebLog(r, userID, "", "вышел из личного кабинета", "")
	}
	writeJSON(w, http.StatusOK, map[string]any{"ok": true})
}

func (a *app) handleMe(w http.ResponseWriter, r *http.Request, userID string) {
	var email, subID, autopayPlan, autopayMethod string
	var days int64
	var autopay bool
	err := a.db.QueryRow(r.Context(), `
SELECT COALESCE(email,''), days, COALESCE(subscription_id,''), autopay_enabled, COALESCE(autopay_plan_id,''), COALESCE(autopay_method_id,'')
FROM users WHERE id=$1`, userID).Scan(&email, &days, &subID, &autopay, &autopayPlan, &autopayMethod)
	if err != nil {
		writeJSON(w, http.StatusNotFound, errResp("пользователь не найден"))
		return
	}
	var expiresAt any
	if days > 0 {
		expiresAt = time.Now().Add(time.Duration(days) * 24 * time.Hour).Format(time.RFC3339)
	}
	writeJSON(w, http.StatusOK, map[string]any{
		"user_id":           userID,
		"masked_id":         maskID(userID),
		"email":             email,
		"days":              days,
		"expires_at":        expiresAt,
		"subscription_id":   subID,
		"subscription_url":  a.subscriptionURL(userID, subID),
		"autopay_enabled":   autopay,
		"autopay_available": autopayMethod != "",
		"autopay_plan_id":   autopayPlan,
	})
}

func (a *app) handlePlans(w http.ResponseWriter, r *http.Request, userID string) {
	visible := append([]plan(nil), plans...)
	if a.adminIDs[userID] {
		visible = append(visible, testPlan)
	}
	writeJSON(w, http.StatusOK, map[string]any{"plans": visible})
}

func (a *app) handleCreatePayment(w http.ResponseWriter, r *http.Request, userID string) {
	if r.Method != http.MethodPost {
		writeJSON(w, http.StatusMethodNotAllowed, errResp("method not allowed"))
		return
	}
	var req struct {
		PlanID   string `json:"plan_id"`
		SaveCard bool   `json:"save_card"`
	}
	if err := readJSON(r, &req); err != nil {
		writeJSON(w, http.StatusBadRequest, errResp("bad json"))
		return
	}
	p, ok := a.findPlan(userID, req.PlanID)
	if !ok {
		writeJSON(w, http.StatusBadRequest, errResp("тариф не найден"))
		return
	}
	if a.yooShopID == "" || a.yooSecret == "" {
		writeJSON(w, http.StatusServiceUnavailable, errResp("YooKassa не настроена для web API"))
		return
	}
	var email string
	_ = a.db.QueryRow(r.Context(), `SELECT COALESCE(email,'') FROM users WHERE id=$1`, userID).Scan(&email)
	paymentURL, paymentID, err := a.createYooPayment(r.Context(), userID, email, p, req.SaveCard, a.paymentReturnBase(r))
	if err != nil {
		log.Printf("web payment create failed user=%s plan=%s: %v", userID, p.ID, err)
		writeJSON(w, http.StatusBadGateway, errResp("не удалось создать платёж"))
		return
	}
	saveCardText := "нет"
	if req.SaveCard {
		saveCardText = "да"
	}
	a.sendWebLog(r, userID, email, "создал счёт", fmt.Sprintf("%s · %.0f ₽ · save card: %s", p.Title, p.Amount, saveCardText))
	writeJSON(w, http.StatusOK, map[string]any{"payment_id": paymentID, "confirmation_url": paymentURL})
}

func (a *app) handleTrafficPacks(w http.ResponseWriter, r *http.Request, userID string) {
	writeJSON(w, http.StatusOK, map[string]any{"packs": []trafficPack{}})
}

func (a *app) handleCreateTrafficPayment(w http.ResponseWriter, r *http.Request, userID string) {
	if r.Method != http.MethodPost {
		writeJSON(w, http.StatusMethodNotAllowed, errResp("method not allowed"))
		return
	}
	writeJSON(w, http.StatusGone, errResp("трафик белых списков теперь безлимитный и не требует доплаты"))
}

func (a *app) handleRefreshTraffic(w http.ResponseWriter, r *http.Request, userID string) {
	if r.Method != http.MethodPost {
		writeJSON(w, http.StatusMethodNotAllowed, errResp("method not allowed"))
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"traffic": map[string]any{"unlimited": true}})
}

func (a *app) handleDisableAutopay(w http.ResponseWriter, r *http.Request, userID string) {
	if r.Method != http.MethodPost {
		writeJSON(w, http.StatusMethodNotAllowed, errResp("method not allowed"))
		return
	}
	_, err := a.db.Exec(r.Context(), `UPDATE users SET autopay_enabled=FALSE, updated_at=NOW() WHERE id=$1`, userID)
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, errResp("не удалось отключить автопродление"))
		return
	}
	a.sendWebLog(r, userID, "", "выключил автосписание", "")
	writeJSON(w, http.StatusOK, map[string]any{"ok": true})
}

func (a *app) handleDetachAutopay(w http.ResponseWriter, r *http.Request, userID string) {
	if r.Method != http.MethodPost {
		writeJSON(w, http.StatusMethodNotAllowed, errResp("method not allowed"))
		return
	}
	_, err := a.db.Exec(r.Context(), `UPDATE users SET autopay_enabled=FALSE, autopay_method_id=NULL, autopay_plan_id=NULL, updated_at=NOW() WHERE id=$1`, userID)
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, errResp("не удалось отвязать карту"))
		return
	}
	a.sendWebLog(r, userID, "", "отвязал карту", "")
	writeJSON(w, http.StatusOK, map[string]any{"ok": true})
}

func (a *app) handleEnableAutopay(w http.ResponseWriter, r *http.Request, userID string) {
	if r.Method != http.MethodPost {
		writeJSON(w, http.StatusMethodNotAllowed, errResp("method not allowed"))
		return
	}
	var planID string
	err := a.db.QueryRow(r.Context(), `
UPDATE users
SET autopay_enabled=TRUE, updated_at=NOW()
WHERE id=$1 AND COALESCE(autopay_method_id,'') <> ''
RETURNING COALESCE(autopay_plan_id,'')`, userID).Scan(&planID)
	if err != nil {
		writeJSON(w, http.StatusBadRequest, errResp("сохранённая карта не найдена"))
		return
	}
	a.sendWebLog(r, userID, "", "включил автосписание", fmt.Sprintf("plan: %s", planID))
	writeJSON(w, http.StatusOK, map[string]any{"ok": true, "autopay_plan_id": planID})
}

func (a *app) handleUILog(w http.ResponseWriter, r *http.Request, userID string) {
	if r.Method != http.MethodPost {
		writeJSON(w, http.StatusMethodNotAllowed, errResp("method not allowed"))
		return
	}
	var req struct {
		Action  string `json:"action"`
		Details string `json:"details"`
		Source  string `json:"source"`
	}
	if err := readJSON(r, &req); err != nil {
		writeJSON(w, http.StatusBadRequest, errResp("bad json"))
		return
	}
	action := normalizeUILogAction(req.Action)
	if action == "" {
		writeJSON(w, http.StatusBadRequest, errResp("unknown action"))
		return
	}
	a.sendWebLogWithSource(r, userID, "", "", action, strings.TrimSpace(req.Details), req.Source)
	writeJSON(w, http.StatusOK, map[string]any{"ok": true})
}

func (a *app) requireAuth(next func(http.ResponseWriter, *http.Request, string)) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		cookie, err := r.Cookie("nvpn_session")
		if err != nil || strings.TrimSpace(cookie.Value) == "" {
			writeJSON(w, http.StatusUnauthorized, errResp("нужен вход"))
			return
		}
		userID, err := a.sessionUserID(r.Context(), cookie.Value)
		if err != nil {
			clearSessionCookie(w)
			writeJSON(w, http.StatusUnauthorized, errResp("сессия истекла"))
			return
		}
		next(w, r, userID)
	}
}

func (a *app) sessionUserID(ctx context.Context, token string) (string, error) {
	var userID string
	err := a.db.QueryRow(ctx, `SELECT user_id FROM web_sessions WHERE token_hash=$1 AND expires_at > NOW()`, sessionHash(token)).Scan(&userID)
	return userID, err
}

func (a *app) withCORS(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if a.corsOrigin != "" {
			w.Header().Set("Access-Control-Allow-Origin", a.corsOrigin)
			w.Header().Set("Access-Control-Allow-Credentials", "true")
			w.Header().Set("Access-Control-Allow-Headers", "Content-Type")
			w.Header().Set("Access-Control-Allow-Methods", "GET,POST,OPTIONS")
		}
		if r.Method == http.MethodOptions {
			w.WriteHeader(http.StatusNoContent)
			return
		}
		next.ServeHTTP(w, r)
	})
}

type account struct {
	ID   string
	Days int64
}

func (a *app) usersByEmail(ctx context.Context, email string) ([]account, error) {
	rows, err := a.db.Query(ctx, `SELECT id, days FROM users WHERE lower(verified_email)=lower($1) ORDER BY verified_email_at DESC NULLS LAST, created_at DESC`, email)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []account
	for rows.Next() {
		var ac account
		if err := rows.Scan(&ac.ID, &ac.Days); err != nil {
			return nil, err
		}
		out = append(out, ac)
	}
	return out, rows.Err()
}

func (a *app) ensureWebUser(ctx context.Context, userID string) error {
	_, err := a.db.Exec(ctx, `
INSERT INTO users (id, last_deduct, updated_at)
VALUES ($1, NOW(), NOW())
ON CONFLICT (id) DO NOTHING`, userID)
	return err
}

type telegramWebAppUser struct {
	ID       string
	Username string
}

func (a *app) validateTelegramWebAppInitData(initData string) (telegramWebAppUser, error) {
	values, err := url.ParseQuery(strings.TrimSpace(initData))
	if err != nil {
		return telegramWebAppUser{}, err
	}
	hash := values.Get("hash")
	if hash == "" {
		return telegramWebAppUser{}, errors.New("missing hash")
	}
	authDateRaw := values.Get("auth_date")
	authUnix, err := strconv.ParseInt(authDateRaw, 10, 64)
	if err != nil {
		return telegramWebAppUser{}, err
	}
	authDate := time.Unix(authUnix, 0)
	if time.Since(authDate) > 24*time.Hour || time.Until(authDate) > 5*time.Minute {
		return telegramWebAppUser{}, errors.New("expired init data")
	}

	keys := make([]string, 0, len(values))
	for key := range values {
		if key == "hash" {
			continue
		}
		keys = append(keys, key)
	}
	sort.Strings(keys)
	checkParts := make([]string, 0, len(keys))
	for _, key := range keys {
		checkParts = append(checkParts, key+"="+values.Get(key))
	}
	checkString := strings.Join(checkParts, "\n")

	secretMAC := hmac.New(sha256.New, []byte("WebAppData"))
	_, _ = secretMAC.Write([]byte(a.botToken))
	secret := secretMAC.Sum(nil)
	dataMAC := hmac.New(sha256.New, secret)
	_, _ = dataMAC.Write([]byte(checkString))
	expected := hex.EncodeToString(dataMAC.Sum(nil))
	if subtle.ConstantTimeCompare([]byte(expected), []byte(hash)) != 1 {
		return telegramWebAppUser{}, errors.New("bad hash")
	}

	var tgUser struct {
		ID       int64  `json:"id"`
		Username string `json:"username"`
	}
	if err := json.Unmarshal([]byte(values.Get("user")), &tgUser); err != nil {
		return telegramWebAppUser{}, err
	}
	if tgUser.ID <= 0 {
		return telegramWebAppUser{}, errors.New("missing user")
	}
	return telegramWebAppUser{
		ID:       strconv.FormatInt(tgUser.ID, 10),
		Username: sanitizeTelegramUsername(tgUser.Username),
	}, nil
}

func (a *app) validateTelegramLoginWidgetData(r *http.Request) (telegramWebAppUser, error) {
	defer r.Body.Close()
	decoder := json.NewDecoder(r.Body)
	decoder.UseNumber()
	var raw map[string]json.RawMessage
	if err := decoder.Decode(&raw); err != nil {
		return telegramWebAppUser{}, err
	}
	hash := rawJSONString(raw["hash"])
	if hash == "" {
		return telegramWebAppUser{}, errors.New("missing hash")
	}

	idRaw := rawJSONText(raw["id"])
	if idRaw == "" {
		return telegramWebAppUser{}, errors.New("missing id")
	}
	if _, err := strconv.ParseInt(idRaw, 10, 64); err != nil {
		return telegramWebAppUser{}, err
	}

	authDateRaw := rawJSONText(raw["auth_date"])
	authUnix, err := strconv.ParseInt(authDateRaw, 10, 64)
	if err != nil {
		return telegramWebAppUser{}, err
	}
	authDate := time.Unix(authUnix, 0)
	if time.Since(authDate) > 24*time.Hour || time.Until(authDate) > 5*time.Minute {
		return telegramWebAppUser{}, errors.New("expired auth date")
	}

	keys := make([]string, 0, len(raw))
	for key := range raw {
		if key == "hash" {
			continue
		}
		keys = append(keys, key)
	}
	sort.Strings(keys)
	checkParts := make([]string, 0, len(keys))
	for _, key := range keys {
		checkParts = append(checkParts, key+"="+rawJSONText(raw[key]))
	}
	checkString := strings.Join(checkParts, "\n")

	secret := sha256.Sum256([]byte(a.botToken))
	dataMAC := hmac.New(sha256.New, secret[:])
	_, _ = dataMAC.Write([]byte(checkString))
	expected := hex.EncodeToString(dataMAC.Sum(nil))
	if subtle.ConstantTimeCompare([]byte(expected), []byte(strings.ToLower(hash))) != 1 {
		return telegramWebAppUser{}, errors.New("bad hash")
	}

	return telegramWebAppUser{
		ID:       idRaw,
		Username: sanitizeTelegramUsername(rawJSONString(raw["username"])),
	}, nil
}

func rawJSONString(raw json.RawMessage) string {
	raw = bytes.TrimSpace(raw)
	if len(raw) == 0 || bytes.Equal(raw, []byte("null")) {
		return ""
	}
	if raw[0] == '"' {
		var s string
		if err := json.Unmarshal(raw, &s); err == nil {
			return s
		}
	}
	var buf bytes.Buffer
	if err := json.Compact(&buf, raw); err == nil {
		return buf.String()
	}
	return string(raw)
}

func rawJSONText(raw json.RawMessage) string {
	if len(raw) == 0 {
		return ""
	}
	var s string
	if json.Unmarshal(raw, &s) == nil {
		return s
	}
	return strings.TrimSpace(string(raw))
}

func publicAccounts(accounts []account) []map[string]any {
	out := make([]map[string]any, 0, len(accounts))
	for _, ac := range accounts {
		out = append(out, map[string]any{"id": ac.ID, "masked_id": maskID(ac.ID), "label": fmt.Sprintf("%s · %d дней", maskID(ac.ID), ac.Days)})
	}
	return out
}

func accountContains(accounts []account, userID string) bool {
	for _, ac := range accounts {
		if ac.ID == userID {
			return true
		}
	}
	return false
}

func (a *app) subscriptionURL(userID, subID string) string {
	if a.mergedBase != "" && a.mergedSecret != "" {
		h := hmac.New(sha256.New, []byte(a.mergedSecret))
		_, _ = h.Write([]byte(userID))
		return fmt.Sprintf("%s/merged-sub/%s/%s", a.mergedBase, url.PathEscape(userID), hex.EncodeToString(h.Sum(nil)))
	}
	if a.subBase != "" && strings.TrimSpace(subID) != "" {
		return fmt.Sprintf("%s/s-39fj3r9f3j/%s", a.subBase, url.PathEscape(subID))
	}
	return ""
}

type webXrayClient struct {
	username   string
	password   string
	serverURL  string
	apiToken   string
	httpClient *http.Client
	authMu     sync.Mutex
	csrfToken  string
}

type webXrayClientData struct {
	ID         string `json:"id"`
	Email      string `json:"email"`
	Enable     bool   `json:"enable"`
	Up         int64  `json:"up"`
	Down       int64  `json:"down"`
	Flow       string `json:"flow"`
	LimitIP    int    `json:"limitIp"`
	TotalGB    int64  `json:"totalGB"`
	ExpiryTime int64  `json:"expiryTime"`
	SubID      string `json:"subId"`
	TgID       string `json:"tgId"`
	Comment    string `json:"comment"`
	Reset      int    `json:"reset"`
	TrafficSet bool   `json:"-"`
}

func (c *webXrayClientData) UnmarshalJSON(data []byte) error {
	var dto struct {
		ID         string `json:"id"`
		Email      string `json:"email"`
		Enable     bool   `json:"enable"`
		Up         int64  `json:"up"`
		Down       int64  `json:"down"`
		Flow       string `json:"flow"`
		LimitIP    int    `json:"limitIp"`
		TotalGB    int64  `json:"totalGB"`
		ExpiryTime int64  `json:"expiryTime"`
		SubID      string `json:"subId"`
		TgID       any    `json:"tgId"`
		Comment    string `json:"comment"`
		Reset      int    `json:"reset"`
	}
	if err := json.Unmarshal(data, &dto); err != nil {
		return err
	}
	*c = webXrayClientData{
		ID:         dto.ID,
		Email:      dto.Email,
		Enable:     dto.Enable,
		Up:         dto.Up,
		Down:       dto.Down,
		Flow:       dto.Flow,
		LimitIP:    dto.LimitIP,
		TotalGB:    dto.TotalGB,
		ExpiryTime: dto.ExpiryTime,
		SubID:      dto.SubID,
		TgID:       normalizeAnyID(dto.TgID),
		Comment:    dto.Comment,
		Reset:      dto.Reset,
	}
	return nil
}

type webXrayClientTraffic struct {
	Email string `json:"email"`
	Up    int64  `json:"up"`
	Down  int64  `json:"down"`
	Total int64  `json:"total"`
}

func newWebMergedXrayFromEnv() (*webXrayClient, []int) {
	inboundIDs := parseCSVInts(os.Getenv("MERGED_XRAY_INBOUND_IDS"))
	if len(inboundIDs) == 0 {
		inboundIDs = parseCSVInts(os.Getenv("MERGED_XRAY_INBOUND_ID"))
	}

	username := strings.TrimSpace(os.Getenv("MERGED_XRAY_USERNAME"))
	password := strings.TrimSpace(os.Getenv("MERGED_XRAY_PASSWORD"))
	apiToken := strings.TrimSpace(os.Getenv("MERGED_XRAY_API_TOKEN"))
	serverURL := strings.TrimRight(strings.TrimSpace(os.Getenv("MERGED_XRAY_PANEL_URL")), "/")
	if serverURL == "" {
		host := strings.TrimSpace(os.Getenv("MERGED_XRAY_HOST"))
		port := strings.TrimSpace(os.Getenv("MERGED_XRAY_PORT"))
		basePath := strings.TrimSpace(os.Getenv("MERGED_XRAY_WEB_BASE_PATH"))
		if host == "" || port == "" {
			return nil, inboundIDs
		}
		protocol := "http"
		if port == "443" || port == "8443" || strings.HasPrefix(host, "https://") {
			protocol = "https"
		}
		host = strings.TrimPrefix(strings.TrimPrefix(host, "https://"), "http://")
		if basePath != "" && !strings.HasPrefix(basePath, "/") {
			basePath = "/" + basePath
		}
		serverURL = fmt.Sprintf("%s://%s:%s%s", protocol, host, port, basePath)
	}
	if serverURL == "" || (apiToken == "" && (username == "" || password == "")) {
		return nil, inboundIDs
	}
	jar, _ := cookiejar.New(nil)
	return &webXrayClient{
		username:  username,
		password:  password,
		apiToken:  apiToken,
		serverURL: strings.TrimRight(serverURL, "/"),
		httpClient: &http.Client{
			Jar:     jar,
			Timeout: 8 * time.Second,
		},
	}, inboundIDs
}

func (x *webXrayClient) login(ctx context.Context) error {
	x.authMu.Lock()
	defer x.authMu.Unlock()

	if strings.TrimSpace(x.apiToken) != "" {
		return nil
	}

	csrfReq, err := http.NewRequestWithContext(ctx, http.MethodGet, x.serverURL+"/csrf-token", nil)
	if err == nil {
		if resp, err := x.httpClient.Do(csrfReq); err == nil {
			body, _ := io.ReadAll(resp.Body)
			_ = resp.Body.Close()
			if resp.StatusCode >= 200 && resp.StatusCode < 300 {
				var result struct {
					Success bool   `json:"success"`
					Obj     string `json:"obj"`
				}
				if json.Unmarshal(body, &result) == nil && result.Success {
					x.csrfToken = result.Obj
				}
			}
		}
	}

	payload, _ := json.Marshal(map[string]string{"username": x.username, "password": x.password})
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, x.serverURL+"/login", bytes.NewReader(payload))
	if err != nil {
		return err
	}
	req.Header.Set("Content-Type", "application/json")
	if x.csrfToken != "" {
		req.Header.Set("X-CSRF-Token", x.csrfToken)
	}
	resp, err := x.httpClient.Do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	body, _ := io.ReadAll(resp.Body)
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return fmt.Errorf("xray login status=%s body=%s", resp.Status, responseSnippet(body))
	}
	if len(bytes.TrimSpace(body)) == 0 {
		return errors.New("xray login returned empty body")
	}
	var result struct {
		Success bool   `json:"success"`
		Msg     string `json:"msg"`
	}
	if err := json.Unmarshal(body, &result); err != nil {
		return fmt.Errorf("xray login invalid response: %w; body=%s", err, responseSnippet(body))
	}
	if !result.Success {
		return fmt.Errorf("xray login failed: %s", strings.TrimSpace(result.Msg))
	}
	return nil
}

func (x *webXrayClient) doRequest(ctx context.Context, method, endpoint string) (int, []byte, error) {
	return x.doRequestOnce(ctx, method, endpoint, true)
}

func (x *webXrayClient) doRequestOnce(ctx context.Context, method, endpoint string, allowRetry bool) (int, []byte, error) {
	req, err := http.NewRequestWithContext(ctx, method, x.serverURL+endpoint, nil)
	if err != nil {
		return 0, nil, err
	}
	req.Header.Set("Accept", "application/json")
	req.Header.Set("X-Requested-With", "XMLHttpRequest")
	if strings.TrimSpace(x.apiToken) != "" {
		req.Header.Set("Authorization", "Bearer "+strings.TrimSpace(x.apiToken))
	}
	if x.csrfToken != "" {
		req.Header.Set("X-CSRF-Token", x.csrfToken)
	}
	resp, err := x.httpClient.Do(req)
	if err != nil {
		return 0, nil, err
	}
	defer resp.Body.Close()
	body, err := io.ReadAll(resp.Body)
	if err != nil {
		return resp.StatusCode, nil, err
	}
	if allowRetry && shouldRetryXrayRequest(resp.StatusCode, body) {
		if err := x.login(ctx); err != nil {
			return resp.StatusCode, body, err
		}
		return x.doRequestOnce(ctx, method, endpoint, false)
	}
	return resp.StatusCode, body, nil
}

func (x *webXrayClient) getInboundClients(ctx context.Context, inboundID int) ([]webXrayClientData, error) {
	status, body, err := x.doRequest(ctx, http.MethodGet, fmt.Sprintf("/panel/api/inbounds/get/%d", inboundID))
	if err != nil {
		return nil, err
	}
	if status < 200 || status >= 300 {
		return nil, fmt.Errorf("xray inbound status=%d body=%s", status, responseSnippet(body))
	}
	var raw struct {
		Success bool   `json:"success"`
		Msg     string `json:"msg"`
		Obj     struct {
			Settings    json.RawMessage        `json:"settings"`
			ClientStats []webXrayClientTraffic `json:"clientStats"`
		} `json:"obj"`
	}
	if err := json.Unmarshal(body, &raw); err != nil {
		return nil, fmt.Errorf("%w; body=%s", err, responseSnippet(body))
	}
	if !raw.Success {
		return nil, fmt.Errorf("xray inbound success=false: %s", raw.Msg)
	}
	var settings struct {
		Clients []webXrayClientData `json:"clients"`
	}
	if err := json.Unmarshal([]byte(rawJSONString(raw.Obj.Settings)), &settings); err != nil {
		return nil, err
	}
	if len(raw.Obj.ClientStats) > 0 {
		statsByEmail := make(map[string]webXrayClientTraffic, len(raw.Obj.ClientStats))
		for _, stat := range raw.Obj.ClientStats {
			email := strings.ToLower(strings.TrimSpace(stat.Email))
			if email != "" {
				statsByEmail[email] = stat
			}
		}
		for i := range settings.Clients {
			email := strings.ToLower(strings.TrimSpace(settings.Clients[i].Email))
			if stat, ok := statsByEmail[email]; ok {
				settings.Clients[i].Up = stat.Up
				settings.Clients[i].Down = stat.Down
				settings.Clients[i].TrafficSet = true
			}
		}
	}
	return settings.Clients, nil
}

func (x *webXrayClient) getClientTrafficByEmail(ctx context.Context, email string) (*webXrayClientTraffic, error) {
	email = strings.TrimSpace(email)
	if email == "" {
		return nil, errors.New("client email is empty")
	}
	encodedEmail := url.PathEscape(email)
	endpoints := []string{
		"/panel/api/clients/traffic/" + encodedEmail,
		"/panel/api/inbounds/getClientTraffics/" + encodedEmail,
	}
	var firstErr error
	for _, endpoint := range endpoints {
		status, body, err := x.doRequest(ctx, http.MethodGet, endpoint)
		if err != nil {
			if firstErr == nil {
				firstErr = err
			}
			continue
		}
		traffic, err := decodeWebXrayTrafficResponse(status, body, email)
		if err == nil {
			return traffic, nil
		}
		if firstErr == nil {
			firstErr = err
		}
	}
	if firstErr != nil {
		return nil, firstErr
	}
	return nil, errors.New("xray traffic response is empty")
}

func decodeWebXrayTrafficResponse(status int, body []byte, email string) (*webXrayClientTraffic, error) {
	if status < 200 || status >= 300 {
		return nil, fmt.Errorf("xray traffic status=%d body=%s", status, responseSnippet(body))
	}
	var raw struct {
		Success bool            `json:"success"`
		Msg     string          `json:"msg"`
		Obj     json.RawMessage `json:"obj"`
	}
	if err := json.Unmarshal(body, &raw); err != nil {
		return nil, fmt.Errorf("%w; body=%s", err, responseSnippet(body))
	}
	if !raw.Success {
		return nil, fmt.Errorf("xray traffic success=false: %s", raw.Msg)
	}
	if len(raw.Obj) == 0 || string(raw.Obj) == "null" {
		return nil, nil
	}
	var traffic webXrayClientTraffic
	if err := json.Unmarshal(raw.Obj, &traffic); err == nil {
		return &traffic, nil
	}
	var list []webXrayClientTraffic
	if err := json.Unmarshal(raw.Obj, &list); err != nil {
		return nil, fmt.Errorf("unexpected xray traffic payload: %s", responseSnippet(raw.Obj))
	}
	if len(list) == 0 {
		return nil, nil
	}
	needle := strings.ToLower(strings.TrimSpace(email))
	for i := range list {
		if strings.ToLower(strings.TrimSpace(list[i].Email)) == needle {
			return &list[i], nil
		}
	}
	return &list[0], nil
}

func (a *app) mergedTrafficStatus(ctx context.Context, userID, subID string, refresh bool) map[string]any {
	live := false
	refreshErr := ""
	if refresh {
		if err := a.refreshMergedTrafficUsage(ctx, userID, subID); err != nil {
			refreshErr = err.Error()
			log.Printf("web merged traffic refresh failed user=%s sub_id=%s: %v", userID, subID, err)
		} else {
			live = true
		}
	}

	now := time.Now().UTC()
	currentMonth := now.Format("2006-01")
	month := currentMonth
	var extraBytes, usedBytes, syncedLimitBytes int64
	var updatedAt time.Time
	err := a.db.QueryRow(ctx, `
SELECT month, extra_allocated_bytes, last_synced_used_bytes, COALESCE(last_synced_limit_bytes, 0), updated_at
FROM merged_traffic WHERE user_id=$1`, userID).Scan(&month, &extraBytes, &usedBytes, &syncedLimitBytes, &updatedAt)
	if err != nil {
		extraBytes = 0
		usedBytes = 0
		syncedLimitBytes = 0
		updatedAt = time.Time{}
	}
	stale := month != currentMonth
	if stale {
		usedOverBase := usedBytes - mergedBaseTrafficBytes
		if usedOverBase < 0 {
			usedOverBase = 0
		}
		extraBytes -= usedOverBase
		if extraBytes < 0 {
			extraBytes = 0
		}
		usedBytes = 0
		syncedLimitBytes = 0
		month = currentMonth
	}
	limitBytes := mergedBaseTrafficBytes + extraBytes
	if syncedLimitBytes > 0 {
		limitBytes = syncedLimitBytes
	}
	remainingBytes := limitBytes - usedBytes
	if remainingBytes < 0 {
		remainingBytes = 0
	}
	usedOverBase := usedBytes - mergedBaseTrafficBytes
	if usedOverBase < 0 {
		usedOverBase = 0
	}
	carryNextBytes := extraBytes - usedOverBase
	if carryNextBytes < 0 {
		carryNextBytes = 0
	}
	return map[string]any{
		"available":        true,
		"month":            month,
		"stale":            stale,
		"limit_bytes":      limitBytes,
		"used_bytes":       usedBytes,
		"remaining_bytes":  remainingBytes,
		"carry_next_bytes": carryNextBytes,
		"limit_gb":         bytesToGB(limitBytes),
		"used_gb":          bytesToGB(usedBytes),
		"remaining_gb":     bytesToGB(remainingBytes),
		"carry_next_gb":    bytesToGB(carryNextBytes),
		"updated_at":       timeOrEmpty(updatedAt),
		"live":             live,
		"refresh_error":    refreshErr,
	}
}

func (a *app) refreshMergedTrafficUsage(ctx context.Context, userID, subID string) error {
	if a.mergedXray == nil || len(a.mergedInbounds) == 0 {
		return errors.New("merged xray is not configured")
	}
	userID = strings.TrimSpace(userID)
	if userID == "" {
		return errors.New("user id is empty")
	}
	now := time.Now().UTC()
	currentMonth := now.Format("2006-01")
	var month string
	err := a.db.QueryRow(ctx, `SELECT month FROM merged_traffic WHERE user_id=$1`, userID).Scan(&month)
	if err == nil && month != "" && month != currentMonth {
		return errors.New("merged traffic month changed; waiting bot monthly sync")
	}

	refreshCtx, cancel := context.WithTimeout(ctx, 8*time.Second)
	defer cancel()

	client, err := a.findMergedXrayClient(refreshCtx, userID, subID)
	if err != nil {
		return err
	}
	if client == nil {
		return errors.New("merged xray client not found")
	}
	traffic, err := a.mergedXray.getClientTrafficByEmail(refreshCtx, client.Email)
	if err != nil {
		if !client.TrafficSet {
			return err
		}
		log.Printf("web merged traffic endpoint failed user=%s email=%s, using inbound clientStats: %v", userID, client.Email, err)
	}
	usedBytes := int64(0)
	if traffic != nil {
		usedBytes = traffic.Up + traffic.Down
	} else if client.TrafficSet {
		usedBytes = client.Up + client.Down
	}
	if usedBytes < 0 {
		usedBytes = 0
	}
	limitBytes := client.TotalGB
	if limitBytes < 0 {
		limitBytes = 0
	}
	_, err = a.db.Exec(ctx, `
INSERT INTO merged_traffic (user_id, month, extra_allocated_bytes, last_synced_used_bytes, last_synced_limit_bytes, updated_at)
VALUES ($1, $2, 0, $3, $4, NOW())
ON CONFLICT (user_id) DO UPDATE
SET last_synced_used_bytes=EXCLUDED.last_synced_used_bytes,
    last_synced_limit_bytes=EXCLUDED.last_synced_limit_bytes,
    updated_at=NOW()
WHERE merged_traffic.month=EXCLUDED.month`,
		userID, currentMonth, usedBytes, limitBytes)
	return err
}

func (a *app) findMergedXrayClient(ctx context.Context, userID, subID string) (*webXrayClientData, error) {
	var lastErr error
	userID = strings.TrimSpace(userID)
	subID = strings.TrimSpace(subID)
	for _, inboundID := range a.mergedInbounds {
		clients, err := a.mergedXray.getInboundClients(ctx, inboundID)
		if err != nil {
			lastErr = err
			continue
		}
		if subID != "" {
			for i := range clients {
				if strings.TrimSpace(clients[i].SubID) == subID {
					return &clients[i], nil
				}
			}
		}
		for i := range clients {
			if mergedTrafficUserIDFromWebClient(clients[i]) == userID {
				return &clients[i], nil
			}
		}
	}
	if lastErr != nil {
		return nil, lastErr
	}
	return nil, nil
}

func mergedTrafficUserIDFromWebClient(client webXrayClientData) string {
	if tgID := strings.TrimSpace(client.TgID); tgID != "" {
		return tgID
	}
	comment := strings.TrimSpace(client.Comment)
	if strings.HasPrefix(comment, "tg:") {
		return strings.TrimSpace(strings.TrimPrefix(comment, "tg:"))
	}
	return ""
}

func normalizeAnyID(value any) string {
	switch v := value.(type) {
	case nil:
		return ""
	case string:
		return strings.TrimSpace(v)
	case float64:
		return strconv.FormatInt(int64(v), 10)
	case int64:
		return strconv.FormatInt(v, 10)
	case int:
		return strconv.Itoa(v)
	case json.Number:
		return v.String()
	default:
		return strings.TrimSpace(fmt.Sprint(v))
	}
}

func (a *app) createYooPayment(ctx context.Context, userID, email string, p plan, saveCard bool, returnBase string) (string, string, error) {
	chatID, _ := strconv.ParseInt(userID, 10, 64)
	returnURL := strings.TrimRight(returnBase, "/") + "/cabinet/?payment=return"
	if returnBase == "" {
		returnURL = "https://t.me/neuravpn_bot"
	}
	reqBody := map[string]any{
		"amount":              map[string]string{"value": fmt.Sprintf("%.2f", p.Amount), "currency": "RUB"},
		"capture":             true,
		"confirmation":        map[string]any{"type": "redirect", "return_url": returnURL},
		"description":         "NeuraVPN " + p.Title,
		"save_payment_method": saveCard,
		"expires_at":          time.Now().UTC().Add(20 * time.Minute).Format(time.RFC3339),
		"metadata": map[string]any{
			"chat_id":     chatID,
			"user_id":     userID,
			"plan_id":     p.ID,
			"plan_title":  p.Title,
			"plan_days":   p.Days,
			"plan_amount": p.Amount,
			"source":      "website",
		},
	}
	if email != "" {
		reqBody["receipt"] = receipt(email, p)
	}
	payload, _ := json.Marshal(reqBody)
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, "https://api.yookassa.ru/v3/payments", bytes.NewReader(payload))
	if err != nil {
		return "", "", err
	}
	auth := base64.StdEncoding.EncodeToString([]byte(a.yooShopID + ":" + a.yooSecret))
	req.Header.Set("Authorization", "Basic "+auth)
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Idempotence-Key", "web-"+userID+"-"+p.ID+"-"+strconv.FormatInt(time.Now().UnixNano(), 10))
	resp, err := (&http.Client{Timeout: 25 * time.Second}).Do(req)
	if err != nil {
		return "", "", err
	}
	defer resp.Body.Close()
	var data struct {
		ID           string         `json:"id"`
		Confirmation map[string]any `json:"confirmation"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&data); err != nil {
		return "", "", err
	}
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return "", "", fmt.Errorf("yookassa status %s", resp.Status)
	}
	confirmationURL, _ := data.Confirmation["confirmation_url"].(string)
	if confirmationURL == "" {
		return "", data.ID, errors.New("confirmation_url is empty")
	}
	return confirmationURL, data.ID, nil
}

func (a *app) createYooTrafficPayment(ctx context.Context, userID, email string, p trafficPack, returnBase string) (string, string, error) {
	chatID, _ := strconv.ParseInt(userID, 10, 64)
	returnURL := strings.TrimRight(returnBase, "/") + "/cabinet/?payment=traffic_return"
	if returnBase == "" {
		returnURL = "https://t.me/neuravpn_bot"
	}
	reqBody := map[string]any{
		"amount":       map[string]string{"value": fmt.Sprintf("%.2f", p.Amount), "currency": "RUB"},
		"capture":      true,
		"confirmation": map[string]any{"type": "redirect", "return_url": returnURL},
		"description":  "NeuraVPN докупка трафика " + p.Title,
		"expires_at":   time.Now().UTC().Add(20 * time.Minute).Format(time.RFC3339),
		"metadata": map[string]any{
			"chat_id":         chatID,
			"user_id":         userID,
			"product_type":    "traffic",
			"traffic_pack_id": p.ID,
			"traffic_gb":      p.GB,
			"traffic_amount":  p.Amount,
			"source":          "website",
		},
	}
	if email != "" {
		reqBody["receipt"] = trafficReceipt(email, p)
	}
	payload, _ := json.Marshal(reqBody)
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, "https://api.yookassa.ru/v3/payments", bytes.NewReader(payload))
	if err != nil {
		return "", "", err
	}
	auth := base64.StdEncoding.EncodeToString([]byte(a.yooShopID + ":" + a.yooSecret))
	req.Header.Set("Authorization", "Basic "+auth)
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Idempotence-Key", "web-"+userID+"-"+p.ID+"-"+strconv.FormatInt(time.Now().UnixNano(), 10))
	resp, err := (&http.Client{Timeout: 25 * time.Second}).Do(req)
	if err != nil {
		return "", "", err
	}
	defer resp.Body.Close()
	var data struct {
		ID           string         `json:"id"`
		Confirmation map[string]any `json:"confirmation"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&data); err != nil {
		return "", "", err
	}
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return "", "", fmt.Errorf("yookassa status %s", resp.Status)
	}
	confirmationURL, _ := data.Confirmation["confirmation_url"].(string)
	if confirmationURL == "" {
		return "", data.ID, errors.New("confirmation_url is empty")
	}
	return confirmationURL, data.ID, nil
}

func (a *app) paymentReturnBase(r *http.Request) string {
	origin := strings.TrimRight(strings.TrimSpace(r.Header.Get("Origin")), "/")
	if origin != "" {
		if u, err := url.Parse(origin); err == nil && (u.Scheme == "http" || u.Scheme == "https") && u.Host != "" {
			return origin
		}
	}
	return a.publicBase
}

func receipt(email string, p plan) map[string]any {
	return map[string]any{"customer": map[string]string{"email": email}, "items": []map[string]any{{"description": "NeuraVPN " + p.Title, "quantity": "1.00", "amount": map[string]string{"value": fmt.Sprintf("%.2f", p.Amount), "currency": "RUB"}, "vat_code": 1, "payment_mode": "full_payment", "payment_subject": "service"}}}
}

func trafficReceipt(email string, p trafficPack) map[string]any {
	return map[string]any{"customer": map[string]string{"email": email}, "items": []map[string]any{{"description": "NeuraVPN трафик " + p.Title, "quantity": "1.00", "amount": map[string]string{"value": fmt.Sprintf("%.2f", p.Amount), "currency": "RUB"}, "vat_code": 1, "payment_mode": "full_payment", "payment_subject": "service"}}}
}

func (a *app) findPlan(userID, id string) (plan, bool) {
	for _, p := range plans {
		if p.ID == id {
			return p, true
		}
	}
	if id == testPlan.ID && a.adminIDs[userID] {
		return testPlan, true
	}
	return plan{}, false
}

func (a *app) findTrafficPack(userID, id string) (trafficPack, bool) {
	for _, p := range trafficPacks {
		if p.ID == id {
			return p, true
		}
	}
	if id == testTrafficPack.ID && a.adminIDs[userID] {
		return testTrafficPack, true
	}
	return trafficPack{}, false
}

func bytesToGB(bytes int64) float64 {
	if bytes <= 0 {
		return 0
	}
	gb := float64(bytes) / float64(gibBytes)
	return math.Round(gb*100) / 100
}

func responseSnippet(body []byte) string {
	trimmed := strings.TrimSpace(string(body))
	if trimmed == "" {
		return "<empty>"
	}
	if len(trimmed) > 300 {
		return trimmed[:300] + "..."
	}
	return trimmed
}

func shouldRetryXrayRequest(statusCode int, body []byte) bool {
	trimmed := bytes.TrimSpace(body)
	if statusCode == http.StatusNotFound || statusCode == http.StatusMethodNotAllowed {
		return false
	}
	return statusCode == http.StatusUnauthorized ||
		statusCode == http.StatusForbidden ||
		len(trimmed) == 0 ||
		bytes.HasPrefix(trimmed, []byte("<"))
}

func timeOrEmpty(t time.Time) string {
	if t.IsZero() {
		return ""
	}
	return t.UTC().Format(time.RFC3339)
}

func (a *app) codeHash(email, code string) string {
	h := hmac.New(sha256.New, a.authSecret)
	_, _ = h.Write([]byte(strings.ToLower(email) + ":" + code))
	return hex.EncodeToString(h.Sum(nil))
}
func sessionHash(token string) string {
	sum := sha256.Sum256([]byte(token))
	return hex.EncodeToString(sum[:])
}
func errResp(message string) map[string]any { return map[string]any{"error": message} }

func readJSON(r *http.Request, dst any) error {
	defer r.Body.Close()
	return json.NewDecoder(r.Body).Decode(dst)
}
func writeJSON(w http.ResponseWriter, status int, v any) {
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(v)
}

func (a *app) sendWebLog(r *http.Request, userID, email, action, details string) {
	a.sendWebLogWithUsername(r, userID, "", email, action, details)
}

func (a *app) sendWebLogWithUsername(r *http.Request, userID, username, email, action, details string) {
	a.sendWebLogWithSource(r, userID, username, email, action, details, "site")
}

func (a *app) sendWebLogWithSource(r *http.Request, userID, username, email, action, details, source string) {
	if a.botToken == "" || a.webLogChatID == "" {
		return
	}
	now := time.Now()
	ip := clientIP(r)
	source = normalizeWebLogSource(source)
	key := source + ":" + webLogKey(userID, email, ip)
	action = webActionText(action, details)

	a.webLogMu.Lock()
	s := a.webLogs[key]
	if s == nil || now.Sub(s.Last) > 10*time.Minute {
		s = &webLogSession{Start: now, Last: now, Source: source}
		a.webLogs[key] = s
	}
	s.Last = now
	s.Source = source
	if userID != "" {
		s.UserID = strings.TrimSpace(userID)
	}
	if username != "" {
		s.Username = sanitizeTelegramUsername(username)
	}
	if email != "" {
		s.Email = strings.TrimSpace(email)
	}
	if ip != "" {
		s.IP = ip
	}
	if action != "" && (len(s.Actions) == 0 || s.Actions[len(s.Actions)-1] != action) {
		s.Actions = append(s.Actions, action)
	}
	if s.Sending {
		s.Dirty = true
		a.webLogMu.Unlock()
		return
	}
	s.Sending = true
	a.webLogMu.Unlock()

	go a.flushWebLogSession(key)
}

func (a *app) flushWebLogSession(key string) {
	for {
		a.webLogMu.Lock()
		s := a.webLogs[key]
		if s == nil {
			a.webLogMu.Unlock()
			return
		}
		text := webLogText(s)
		msgID := s.MsgID
		s.Dirty = false
		a.webLogMu.Unlock()

		newMsgID := 0
		var err error
		if msgID == 0 {
			newMsgID, err = a.telegramSendMessage(text)
		} else {
			err = a.telegramEditMessage(msgID, text)
		}
		if err != nil {
			log.Printf("web log telegram failed: %v", err)
		}

		a.webLogMu.Lock()
		s = a.webLogs[key]
		if s == nil {
			a.webLogMu.Unlock()
			return
		}
		if newMsgID != 0 {
			s.MsgID = newMsgID
		}
		if s.Dirty {
			a.webLogMu.Unlock()
			continue
		}
		s.Sending = false
		a.webLogMu.Unlock()
		return
	}
}

func webLogText(s *webLogSession) string {
	var b strings.Builder
	if s.Source == "miniapp" {
		b.WriteString("📱 <b>С MiniApp</b>\n")
	} else {
		b.WriteString("🌐 <b>С сайта</b>\n")
	}
	if s.UserID != "" {
		b.WriteString("👤 " + telegramUserLink(s.UserID, s.Username))
		if s.Email != "" {
			b.WriteString(" · <code>" + html.EscapeString(s.Email) + "</code>")
		}
		b.WriteByte('\n')
	} else if s.Email != "" {
		b.WriteString("👤 <code>" + html.EscapeString(s.Email) + "</code>\n")
	}

	mins := int(math.Round(s.Last.Sub(s.Start).Round(time.Minute).Minutes()))
	if mins < 1 {
		mins = 1
	}
	b.WriteString(fmt.Sprintf("🕒 %s–%s · сессия %s\n", s.Start.Format("15:04"), s.Last.Format("15:04"), minutesLabel(mins)))

	actions := "—"
	if len(s.Actions) > 0 {
		actions = strings.Join(s.Actions, " → ")
	}
	b.WriteString("🔗 действия: " + html.EscapeString(actions))
	return strings.TrimSpace(b.String())
}

func normalizeWebLogSource(source string) string {
	switch strings.ToLower(strings.TrimSpace(source)) {
	case "miniapp", "mini_app", "mini-app":
		return "miniapp"
	default:
		return "site"
	}
}

func (a *app) telegramSendMessage(text string) (int, error) {
	var data struct {
		OK     bool `json:"ok"`
		Result struct {
			MessageID int `json:"message_id"`
		} `json:"result"`
		Description string `json:"description"`
	}
	if err := a.telegramRequest("sendMessage", 0, text, &data); err != nil {
		return 0, err
	}
	if !data.OK {
		return 0, fmt.Errorf("sendMessage: %s", data.Description)
	}
	return data.Result.MessageID, nil
}

func (a *app) telegramEditMessage(messageID int, text string) error {
	var data struct {
		OK          bool   `json:"ok"`
		Description string `json:"description"`
	}
	if err := a.telegramRequest("editMessageText", messageID, text, &data); err != nil {
		return err
	}
	if !data.OK && !strings.Contains(strings.ToLower(data.Description), "message is not modified") {
		return fmt.Errorf("editMessageText: %s", data.Description)
	}
	return nil
}

func (a *app) telegramRequest(method string, messageID int, text string, dst any) error {
	ctx, cancel := context.WithTimeout(context.Background(), 8*time.Second)
	defer cancel()

	form := url.Values{}
	form.Set("chat_id", a.webLogChatID)
	form.Set("text", text)
	form.Set("parse_mode", "HTML")
	form.Set("disable_web_page_preview", "true")
	if messageID > 0 {
		form.Set("message_id", strconv.Itoa(messageID))
	}

	endpoint := "https://api.telegram.org/bot" + a.botToken + "/" + method
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, endpoint, strings.NewReader(form.Encode()))
	if err != nil {
		return err
	}
	req.Header.Set("Content-Type", "application/x-www-form-urlencoded")

	resp, err := (&http.Client{Timeout: 8 * time.Second}).Do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	if err := json.NewDecoder(resp.Body).Decode(dst); err != nil {
		return err
	}
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return fmt.Errorf("%s status=%s", method, resp.Status)
	}
	return nil
}

func telegramUserLink(userID, username string) string {
	if id, err := strconv.ParseInt(strings.TrimSpace(userID), 10, 64); err == nil && id > 0 {
		escaped := html.EscapeString(userID)
		if username != "" {
			return fmt.Sprintf(`<a href="https://t.me/%s">@%s</a> (ID:%s)`, html.EscapeString(username), html.EscapeString(username), escaped)
		}
		return fmt.Sprintf(`<a href="tg://user?id=%d">ID:%s</a>`, id, escaped)
	}
	return "<code>" + html.EscapeString(userID) + "</code>"
}

func webLogKey(userID, email, ip string) string {
	if strings.TrimSpace(userID) != "" {
		return "u:" + strings.TrimSpace(userID)
	}
	if strings.TrimSpace(email) != "" {
		return "e:" + strings.ToLower(strings.TrimSpace(email))
	}
	return "ip:" + strings.TrimSpace(ip)
}

func webActionText(action, details string) string {
	action = strings.TrimSpace(action)
	details = strings.TrimSpace(details)
	action = webActionEmoji(action)
	if details == "" {
		return action
	}
	if action == "" {
		return details
	}
	return action + ": " + details
}

func webActionEmoji(action string) string {
	switch action {
	case "Профиль MiniApp", "вошёл в личный кабинет", "вошёл через Telegram", "вошёл через Telegram Mini App":
		return "👤 " + action
	case "начал вход через Telegram":
		return "🔐 " + action
	case "вышел из личного кабинета":
		return "🚪 " + action
	case "создал счёт":
		return "🔗 счёт создан"
	case "создал счёт на трафик":
		return "📶 счёт на трафик"
	case "выбрал тариф":
		return "💰 " + action
	case "выбрал пакет трафика":
		return "📶 " + action
	case "скопировал ключ":
		return "📋 " + action
	case "открыл инструкцию":
		return "🛠 инструкция"
	case "включил автосписание":
		return "🔄 " + action
	case "выключил автосписание":
		return "⏸ " + action
	case "отвязал карту":
		return "💳 " + action
	case "запросил код входа":
		return "📧 " + action
	default:
		return action
	}
}

func normalizeUILogAction(action string) string {
	switch strings.TrimSpace(action) {
	case "plan_selected":
		return "выбрал тариф"
	case "copy_key":
		return "скопировал ключ"
	case "instruction_open":
		return "открыл инструкцию"
	case "traffic_pack_selected":
		return "выбрал пакет трафика"
	default:
		return ""
	}
}

func sanitizeTelegramUsername(username string) string {
	username = strings.TrimPrefix(strings.TrimSpace(username), "@")
	if username == "" {
		return ""
	}
	for _, r := range username {
		if (r >= 'a' && r <= 'z') || (r >= 'A' && r <= 'Z') || (r >= '0' && r <= '9') || r == '_' {
			continue
		}
		return ""
	}
	return username
}

func minutesLabel(mins int) string {
	if mins%10 == 1 && mins%100 != 11 {
		return fmt.Sprintf("%d мин", mins)
	}
	return fmt.Sprintf("%d мин", mins)
}

func clientIP(r *http.Request) string {
	if r == nil {
		return ""
	}
	if forwarded := strings.TrimSpace(r.Header.Get("X-Forwarded-For")); forwarded != "" {
		parts := strings.Split(forwarded, ",")
		return strings.TrimSpace(parts[0])
	}
	host, _, err := net.SplitHostPort(strings.TrimSpace(r.RemoteAddr))
	if err == nil {
		return host
	}
	return strings.TrimSpace(r.RemoteAddr)
}

func normalizeEmail(value string) (string, error) {
	value = strings.TrimSpace(strings.ToLower(value))
	addr, err := mail.ParseAddress(value)
	if err != nil || addr.Address == "" {
		return "", errors.New("bad email")
	}
	return addr.Address, nil
}
func randomDigits(n int) string {
	b := make([]byte, n)
	_, _ = rand.Read(b)
	var sb strings.Builder
	for _, x := range b {
		sb.WriteByte(byte('0' + int(x)%10))
	}
	return sb.String()
}
func randomToken(n int) string {
	b := make([]byte, n)
	_, _ = rand.Read(b)
	return base64.RawURLEncoding.EncodeToString(b)
}

func setSessionCookie(w http.ResponseWriter, token string, expires time.Time) {
	http.SetCookie(w, &http.Cookie{Name: "nvpn_session", Value: token, Path: "/", Expires: expires, HttpOnly: true, Secure: webCookieSecure(), SameSite: webCookieSameSite()})
}
func clearSessionCookie(w http.ResponseWriter) {
	http.SetCookie(w, &http.Cookie{Name: "nvpn_session", Value: "", Path: "/", MaxAge: -1, HttpOnly: true, Secure: webCookieSecure(), SameSite: webCookieSameSite()})
}

func webCookieSecure() bool {
	return strings.ToLower(strings.TrimSpace(os.Getenv("WEB_COOKIE_SECURE"))) != "false"
}

func webCookieSameSite() http.SameSite {
	switch strings.ToLower(strings.TrimSpace(os.Getenv("WEB_COOKIE_SAMESITE"))) {
	case "none":
		return http.SameSiteNoneMode
	case "strict":
		return http.SameSiteStrictMode
	default:
		return http.SameSiteLaxMode
	}
}

func maskID(id string) string {
	if len(id) <= 6 {
		return id
	}
	return id[:4] + strings.Repeat("*", int(math.Min(4, float64(len(id)-6)))) + id[len(id)-3:]
}

func parseAdminIDs(raw string) map[string]bool {
	ids := map[string]bool{}
	for _, part := range strings.Split(raw, ",") {
		id := strings.TrimSpace(part)
		if id != "" {
			ids[id] = true
		}
	}
	return ids
}

func parseCSVInts(raw string) []int {
	var ids []int
	for _, part := range strings.Split(raw, ",") {
		value, err := strconv.Atoi(strings.TrimSpace(part))
		if err == nil && value > 0 {
			ids = append(ids, value)
		}
	}
	return ids
}

func envOrDefault(key, fallback string) string {
	if value := strings.TrimSpace(os.Getenv(key)); value != "" {
		return value
	}
	return fallback
}

func sendLoginCode(email, code string) error {
	host := strings.TrimSpace(os.Getenv("SMTP_HOST"))
	user := strings.TrimSpace(os.Getenv("SMTP_USER"))
	pass := strings.TrimSpace(os.Getenv("SMTP_PASS"))
	from := strings.TrimSpace(os.Getenv("SMTP_FROM"))
	port := strings.TrimSpace(os.Getenv("SMTP_PORT"))
	if host == "" || user == "" || pass == "" {
		log.Printf("WEB LOGIN CODE email=%s code=%s", email, code)
		return nil
	}
	if from == "" {
		from = user
	}
	if port == "" {
		port = "587"
	}
	addr := net.JoinHostPort(host, port)
	subject := mime.QEncoding.Encode("UTF-8", "neuravpn код от личного кабинета.")
	body := "никому не сообщайте код от входа в личный кабинет!\r\n" +
		"код в neuravpn: " + code + "\r\n" +
		"Он действует 10 минут.\r\n" +
		"По вопросам поддержки пишите в телеграм -> https://t.me/neuravpn_support\r\n"
	msg := []byte("From: " + from + "\r\nTo: " + email + "\r\nSubject: " + subject + "\r\nMIME-Version: 1.0\r\nContent-Type: text/plain; charset=UTF-8\r\n\r\n" + body)
	auth := smtp.PlainAuth("", user, pass, host)
	if port == "465" {
		conn, err := tls.Dial("tcp", addr, &tls.Config{ServerName: host, MinVersion: tls.VersionTLS12})
		if err != nil {
			return err
		}
		defer conn.Close()
		client, err := smtp.NewClient(conn, host)
		if err != nil {
			return err
		}
		defer client.Quit()
		if err := client.Auth(auth); err != nil {
			return err
		}
		if err := client.Mail(from); err != nil {
			return err
		}
		if err := client.Rcpt(email); err != nil {
			return err
		}
		wc, err := client.Data()
		if err != nil {
			return err
		}
		_, err = wc.Write(msg)
		if closeErr := wc.Close(); err == nil {
			err = closeErr
		}
		return err
	}
	return smtp.SendMail(addr, auth, from, []string{email}, msg)
}
