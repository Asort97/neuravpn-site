package main

import (
	"context"
	"encoding/json"
	"io"
	"net/http"
	"strings"
	"testing"
	"time"
)

func TestSaleQuotesAndPromoComparison(t *testing.T) {
	a := &app{authSecret: []byte("test")}
	p := plan{ID: "30d", Amount: 149, DeviceExtra: 2, Sale: &activePromo{Code: "BLACKFRIDAY", Discount: 50, Until: time.Now().Add(time.Hour), AllProducts: true}}
	promo := &activePromo{Code: "SAVE25", Discount: 25, Until: time.Now().Add(time.Hour)}
	q := a.makePaymentQuote("42", p, promo)
	if q.Amount != 124.5 || q.DeviceAmount != 50 || !q.Sale || q.Discount != 50 || !a.validPaymentQuote(q.Token, "42", p, promo) {
		t.Fatal(q)
	}
	promo.Discount = 90
	q = a.makePaymentQuote("42", p, promo)
	if q.Amount != 114.9 || q.Sale || q.PromoCode != "SAVE25" {
		t.Fatal("worse discount selected", q)
	}
	p.Sale.Until = time.Now().Add(-time.Second)
	q = a.makePaymentQuote("42", p, nil)
	if a.validPaymentQuote(q.Token, "42", p, nil) {
		t.Fatal("expired sale quote accepted")
	}
	p.Sale.Until = time.Now().Add(time.Hour)
	q = a.makePaymentQuote("42", p, nil)
	p.Sale = nil
	if a.validPaymentQuote(q.Token, "42", p, nil) {
		t.Fatal("stopped sale quote accepted")
	}
}

func TestSaleIntegrationInvoicesAndExpiry(t *testing.T) {
	a := integrationApp(t)
	ctx := context.Background()
	_, err := a.db.Exec(ctx, `CREATE TABLE promocodes(code TEXT PRIMARY KEY,discount INT NOT NULL,expires_at TIMESTAMPTZ NOT NULL);
CREATE TABLE user_promocodes(user_id TEXT NOT NULL,code TEXT REFERENCES promocodes(code),discount_until TIMESTAMPTZ NOT NULL,PRIMARY KEY(user_id,code));
INSERT INTO users(id) VALUES('42');INSERT INTO device_plans(user_id,enabled,extra_slots) VALUES('42',TRUE,2);
INSERT INTO global_sale(singleton,name,percent,ends_at,created_by) VALUES(TRUE,'BLACKFRIDAY',50,NOW()+INTERVAL '1 hour','42');`)
	if err != nil {
		t.Fatal(err)
	}
	s, err := a.activeSale(ctx)
	if err != nil || s == nil {
		t.Fatal(s, err)
	}
	p := plans[0]
	p.DeviceExtra = 2
	p.Sale = s
	q := a.makePaymentQuote("42", p, nil)
	old := http.DefaultTransport
	defer func() { http.DefaultTransport = old }()
	calls := 0
	http.DefaultTransport = featureRoundTrip(func(r *http.Request) (*http.Response, error) {
		calls++
		if r.URL.Host != "api.yookassa.ru" {
			t.Fatal("unexpected external request")
		}
		var body map[string]any
		json.NewDecoder(r.Body).Decode(&body)
		if body["amount"].(map[string]any)["value"] != "124.50" || body["metadata"].(map[string]any)["plan_amount"] != 124.5 {
			t.Fatal(body)
		}
		return &http.Response{StatusCode: 200, Body: io.NopCloser(strings.NewReader(`{"id":"test","confirmation":{"confirmation_url":"https://example.invalid/payment"}}`)), Header: make(http.Header)}, nil
	})
	a.yooShopID, a.yooSecret = "test", "test"
	body, _ := json.Marshal(map[string]any{"plan_id": "30d", "quote": q.Token})
	w := postAuth(func(w http.ResponseWriter, r *http.Request) { a.handleCreatePayment(w, r, "42") }, "/api/payments/create", string(body))
	if w.Code != 200 || calls != 1 {
		t.Fatal(w.Code, w.Body.String(), calls)
	}
	if _, err = a.db.Exec(ctx, `UPDATE global_sale SET ends_at=NOW()-INTERVAL '1 second'`); err != nil {
		t.Fatal(err)
	}
	w = postAuth(func(w http.ResponseWriter, r *http.Request) { a.handleCreatePayment(w, r, "42") }, "/api/payments/create", string(body))
	if w.Code != 409 || calls != 1 {
		t.Fatal("stale quote charged", w.Code, calls)
	}
	s, err = a.activeSale(ctx)
	if err != nil || s != nil {
		t.Fatal("expired active", s, err)
	}
}
