package main

import (
	"context"
	"crypto/hmac"
	"crypto/sha256"
	"encoding/hex"
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
	old := a.subscriptionURL("623290294", "sub")
	other := a.subscriptionURL("42", "sub")
	if old == "" {
		t.Fatal("legacy pilot URL missing")
	}
	_, err = a.db.Exec(ctx, `INSERT INTO subscription_reissues VALUES('623290294','generation',FALSE)`)
	if err != nil {
		t.Fatal(err)
	}
	if a.subscriptionURL("623290294", "sub") != "" {
		t.Fatal("pending URL published")
	}
	_, err = a.db.Exec(ctx, `UPDATE subscription_reissues SET active=TRUE`)
	if err != nil {
		t.Fatal(err)
	}
	h := hmac.New(sha256.New, []byte(a.mergedSecret))
	h.Write([]byte("623290294\nreissue-v1\ngeneration"))
	expected := a.mergedBase + "/merged-sub/623290294/" + hex.EncodeToString(h.Sum(nil))
	if got := a.subscriptionURL("623290294", "sub"); got != expected || got == old {
		t.Fatal("bot/site token mismatch")
	}
	if a.subscriptionURL("42", "sub") != other {
		t.Fatal("other account changed")
	}
	_, err = a.db.Exec(ctx, `DROP TABLE subscription_reissues`)
	if err != nil {
		t.Fatal(err)
	}
	if a.subscriptionURL("623290294", "sub") != "" || a.subscriptionURL("42", "sub") != other {
		t.Fatal("DB error not isolated to pilot")
	}
}

func TestReissueEndpointRejectsOtherUser(t *testing.T) {
	a := &app{}
	for _, path := range []string{"/api/devices/reissue", "/api/devices/reissue-status"} {
		w := httptest.NewRecorder()
		r := httptest.NewRequest("POST", path, strings.NewReader(`{"id":"initial"}`))
		a.handleDevices(w, r, "42")
		if w.Code != 403 {
			t.Fatalf("non-pilot status %d", w.Code)
		}
	}
}
