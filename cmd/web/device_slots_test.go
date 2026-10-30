package main

import (
	"context"
	"net/http"
	"strings"
	"testing"
	"time"
)

func TestDeviceExtrasAreNotDiscountedAndInvalidateOldQuote(t *testing.T) {
	a := &app{authSecret: []byte("test")}
	p := plans[2]
	p.DeviceExtra = 2
	promo := &activePromo{Code: "SAVE25", Discount: 25, Until: time.Now().Add(time.Hour)}
	q := a.makePaymentQuote("42", p, promo)
	if q.Amount != 414.25 || q.BaseAmount != 519 || q.DeviceAmount != 100 || !a.validPaymentQuote(q.Token, "42", p, promo) {
		t.Fatalf("wrong extra slot quote %+v", q)
	}
	p.DeviceExtra = 1
	if a.validPaymentQuote(q.Token, "42", p, promo) {
		t.Fatal("stale slot price accepted")
	}
}

func TestDeviceAutopayIntegrationPriceConfirmation(t *testing.T) {
	a := integrationApp(t)
	ctx := context.Background()
	_, err := a.db.Exec(ctx, `ALTER TABLE users ADD COLUMN autopay_method_id TEXT, ADD COLUMN autopay_plan_id TEXT, ADD COLUMN autopay_enabled BOOLEAN DEFAULT FALSE; INSERT INTO users(id,autopay_method_id,autopay_plan_id) VALUES('42','saved','90d'); INSERT INTO device_plans(user_id,enabled,extra_slots) VALUES('42',TRUE,2)`)
	if err != nil {
		t.Fatal(err)
	}
	p, err := a.devicePlan(ctx, "43")
	if err != nil || p.Enabled || p.ExtraSlots != 0 {
		t.Fatal("default limit not off")
	}
	for _, body := range []string{`{}`, `{"device_extra_slots":1}`} {
		w := postAuth(func(w http.ResponseWriter, r *http.Request) { a.handleEnableAutopay(w, r, "42") }, "/api/autopay/enable", body)
		if w.Code != 409 {
			t.Fatal("stale price accepted", w.Code)
		}
	}
	w := postAuth(func(w http.ResponseWriter, r *http.Request) { a.handleEnableAutopay(w, r, "42") }, "/api/autopay/enable", `{"device_extra_slots":2}`)
	if w.Code != 200 || !strings.Contains(w.Body.String(), `"ok":true`) {
		t.Fatal(w.Code, w.Body.String())
	}
}
