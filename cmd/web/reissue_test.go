package main

import (
	"context"
	"crypto/hmac"
	"crypto/sha256"
	"encoding/hex"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func TestReissueIntegrationSubscriptionURL(t *testing.T) {
	a := integrationApp(t)
	a.mergedBase, a.mergedSecret = "https://example.invalid", "test-secret"
	ctx := context.Background()
	_, err := a.db.Exec(ctx, `CREATE TABLE subscription_reissues(user_id TEXT PRIMARY KEY,generation TEXT,active BOOLEAN)`)
	if err != nil {
		t.Fatal(err)
	}
	old := a.subscriptionURL("84", "sub")
	other := a.subscriptionURL("42", "sub")
	if old == "" {
		t.Fatal("legacy pilot URL missing")
	}
	_, err = a.db.Exec(ctx, `INSERT INTO subscription_reissues VALUES('84','generation',FALSE)`)
	if err != nil {
		t.Fatal(err)
	}
	if a.subscriptionURL("84", "sub") != "" {
		t.Fatal("pending URL published")
	}
	_, err = a.db.Exec(ctx, `UPDATE subscription_reissues SET active=TRUE`)
	if err != nil {
		t.Fatal(err)
	}
	h := hmac.New(sha256.New, []byte(a.mergedSecret))
	h.Write([]byte("84\nreissue-v1\ngeneration"))
	expected := a.mergedBase + "/merged-sub/84/" + hex.EncodeToString(h.Sum(nil))
	if got := a.subscriptionURL("84", "sub"); got != expected || got == old {
		t.Fatal("bot/site token mismatch")
	}
	if a.subscriptionURL("42", "sub") != other {
		t.Fatal("other account changed")
	}
	_, err = a.db.Exec(ctx, `DROP TABLE subscription_reissues`)
	if err != nil {
		t.Fatal(err)
	}
	if a.subscriptionURL("84", "sub") != "" || a.subscriptionURL("42", "sub") != "" {
		t.Fatal("DB error must fail closed")
	}
}

func TestReissueEndpointUsesAuthenticatedOwner(t *testing.T) {
	a := &app{botToken: "test"}
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		body, _ := io.ReadAll(r.Body)
		if !strings.Contains(string(body), `"user_id":"42"`) || strings.Contains(string(body), "999") {
			t.Error("wrong owner", string(body))
		}
		io.WriteString(w, `{"devices":[],"reissue":{"allowed":true,"generation":"initial"}}`)
	}))
	defer server.Close()
	t.Setenv("BOT_WEB_DEVICES_URL", server.URL+webDevicesPath)
	for _, path := range []string{"/api/devices/reissue", "/api/devices/reissue-status"} {
		w := httptest.NewRecorder()
		r := httptest.NewRequest("POST", path, strings.NewReader(`{"id":"initial","user_id":"999"}`))
		a.handleDevices(w, r, "42")
		if w.Code != 200 {
			t.Fatalf("regular user status %d", w.Code)
		}
	}
}
