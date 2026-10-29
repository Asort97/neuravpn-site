package main

import (
	"context"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"
)

func TestPaymentQuoteBoundToUserPlanAndCurrentDiscount(t *testing.T) {
	a := &app{authSecret: []byte("test")}
	p := plans[2]
	promo := &activePromo{Code: "SAVE25", Discount: 25, Until: time.Now().Add(time.Hour)}
	q := a.makePaymentQuote("42", p, promo)
	if q.Amount != 314.25 || !a.validPaymentQuote(q.Token, "42", p, promo) {
		t.Fatal("wrong discounted quote")
	}
	if a.validPaymentQuote(q.Token, "43", p, promo) || a.validPaymentQuote(q.Token, "42", plans[0], promo) || a.validPaymentQuote(q.Token, "42", p, nil) || a.validPaymentQuote(q.Token+"x", "42", p, promo) {
		t.Fatal("forged or stale quote accepted")
	}
	promo.Discount = 30
	if a.validPaymentQuote(q.Token, "42", p, promo) {
		t.Fatal("changed discount accepted")
	}
	promo.Until = time.Now().Add(-time.Second)
	q = a.makePaymentQuote("42", p, promo)
	if a.validPaymentQuote(q.Token, "42", p, promo) {
		t.Fatal("expired quote accepted")
	}
}

func TestDeviceProxySignsAuthenticatedOwnerAndRejectsRedirect(t *testing.T) {
	a := &app{botToken: "test-secret"}
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		body, _ := io.ReadAll(r.Body)
		proof := webDevicesMAC(a.botToken, "POST\n"+webDevicesPath+"\n"+r.Header.Get("X-Device-Time")+"\n"+r.Header.Get("X-Device-Nonce")+"\n"+string(body))
		if proof != r.Header.Get("X-Device-Signature") {
			t.Error("invalid signature")
		}
		var req map[string]string
		json.Unmarshal(body, &req)
		if req["user_id"] != "42" {
			t.Error("client-supplied user id trusted")
		}
		io.WriteString(w, `{"devices":[],"partial":true}`)
	}))
	defer server.Close()
	t.Setenv("BOT_WEB_DEVICES_URL", server.URL+webDevicesPath)
	w := httptest.NewRecorder()
	r := httptest.NewRequest("POST", "/api/devices/delete", strings.NewReader(`{"user_id":"999","id":"`+strings.Repeat("a", 64)+`"}`))
	a.handleDevices(w, r, "42")
	if w.Code != 200 {
		t.Fatal(w.Body.String())
	}
	t.Setenv("BOT_WEB_DEVICES_URL", "http://203.0.113.1:8080"+webDevicesPath)
	if _, err := a.fetchDevices(context.Background(), "42", "list", ""); err == nil {
		t.Fatal("remote endpoint allowed")
	}
	redirect := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { http.Redirect(w, r, server.URL+webDevicesPath, 307) }))
	defer redirect.Close()
	t.Setenv("BOT_WEB_DEVICES_URL", redirect.URL+webDevicesPath)
	if _, err := a.fetchDevices(context.Background(), "42", "list", ""); err == nil {
		t.Fatal("redirect followed")
	}
}

func TestFeaturesRequireAuthentication(t *testing.T) {
	a := &app{}
	for path, handler := range map[string]func(http.ResponseWriter, *http.Request, string){"/api/devices": a.handleDevices, "/api/devices/delete": a.handleDevices, "/api/promocode/apply": a.handleApplyPromocode, "/api/payments/quote": a.handlePaymentQuote} {
		w := httptest.NewRecorder()
		a.requireAuth(handler)(w, httptest.NewRequest("POST", path, strings.NewReader(`{}`)))
		if w.Code != 401 {
			t.Fatal(path, w.Code)
		}
	}
}

func TestPromoIntegrationActivationPricingAndRepeat(t *testing.T) {
	a := integrationApp(t)
	_, err := a.db.Exec(context.Background(), `CREATE TABLE promocodes(code TEXT PRIMARY KEY,discount INT NOT NULL,expires_at TIMESTAMPTZ NOT NULL);
CREATE TABLE user_promocodes(user_id TEXT NOT NULL,code TEXT REFERENCES promocodes(code),discount_until TIMESTAMPTZ NOT NULL,PRIMARY KEY(user_id,code));
INSERT INTO promocodes VALUES('SAVE25',25,NOW()+INTERVAL '2 hour'),('OLD',50,NOW()-INTERVAL '1 hour'),('SHORT',10,NOW()+INTERVAL '1 hour');`)
	if err != nil {
		t.Fatal(err)
	}
	call := func(code string) *httptest.ResponseRecorder {
		return postAuth(func(w http.ResponseWriter, r *http.Request) { a.handleApplyPromocode(w, r, "42") }, "/api/promocode/apply", `{"plan_id":"90d","code":"`+code+`"}`)
	}
	for _, code := range []string{"missing", "OLD"} {
		if w := call(code); w.Code != 404 {
			t.Fatal(code, w.Code)
		}
	}
	w := call(" save25 ")
	if w.Code != 200 || !strings.Contains(w.Body.String(), `"amount":314.25`) {
		t.Fatal(w.Body.String())
	}
	w = call("SAVE25")
	if w.Code != 200 || !strings.Contains(w.Body.String(), "уже активирован") {
		t.Fatal(w.Body.String())
	}
	var count int
	a.db.QueryRow(context.Background(), `SELECT COUNT(*) FROM user_promocodes WHERE user_id='42'`).Scan(&count)
	if count != 1 {
		t.Fatal("duplicate activation")
	}
	w = call("SHORT")
	if w.Code != 200 || !strings.Contains(w.Body.String(), `"promo_code":"SAVE25"`) || !strings.Contains(w.Body.String(), "не суммируются") {
		t.Fatal("selection differs from bot", w.Body.String())
	}
	if promo, err := a.activePromocode(context.Background(), "99"); err != nil || promo != nil {
		t.Fatal("another user's discount leaked")
	}
	// Intercept the payment transport: no real payment is ever created by tests.
	oldTransport := http.DefaultTransport
	t.Cleanup(func() { http.DefaultTransport = oldTransport })
	requests := 0
	http.DefaultTransport = featureRoundTrip(func(r *http.Request) (*http.Response, error) {
		requests++
		if r.URL.Host != "api.yookassa.ru" {
			t.Fatal("unexpected external request")
		}
		var payload map[string]any
		json.NewDecoder(r.Body).Decode(&payload)
		if payload["amount"].(map[string]any)["value"] != "314.25" || payload["metadata"].(map[string]any)["plan_amount"] != 314.25 {
			t.Fatal("discount not in actual payment", payload)
		}
		return &http.Response{StatusCode: 200, Body: io.NopCloser(strings.NewReader(`{"id":"test","confirmation":{"confirmation_url":"https://example.invalid/payment"}}`)), Header: make(http.Header)}, nil
	})
	a.yooShopID, a.yooSecret = "test", "test"
	promo, _ := a.activePromocode(context.Background(), "42")
	q := a.makePaymentQuote("42", plans[2], promo)
	for _, save := range []bool{false, true} {
		body, _ := json.Marshal(map[string]any{"plan_id": "90d", "save_card": save, "quote": q.Token, "amount": 1, "discount": 99})
		w := postAuth(func(w http.ResponseWriter, r *http.Request) { a.handleCreatePayment(w, r, "42") }, "/api/payments/create", string(body))
		if w.Code != 200 {
			t.Fatal(w.Code, w.Body.String())
		}
	}
	if requests != 2 {
		t.Fatal("payment paths not tested")
	}
	a.db.Exec(context.Background(), `UPDATE user_promocodes SET discount_until=NOW()-INTERVAL '1 minute'`)
	body, _ := json.Marshal(map[string]any{"plan_id": "90d", "quote": q.Token})
	w = postAuth(func(w http.ResponseWriter, r *http.Request) { a.handleCreatePayment(w, r, "42") }, "/api/payments/create", string(body))
	if w.Code != 409 || requests != 2 {
		t.Fatal("expired discount silently became a full-price payment")
	}
	if w := call("SAVE25"); w.Code != 409 {
		t.Fatal("expired activation reused", w.Body.String())
	}
	if promo, err := a.activePromocode(context.Background(), "42"); err != nil || promo != nil {
		t.Fatal("expired discount applied")
	}
}

type featureRoundTrip func(*http.Request) (*http.Response, error)

func (f featureRoundTrip) RoundTrip(r *http.Request) (*http.Response, error) { return f(r) }
