package main

import (
	"context"
	"crypto/hmac"
	"crypto/sha256"
	"encoding/hex"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func TestSubscriptionStatusUsesSignedBotStatus(t *testing.T) {
	h := hmac.New(sha256.New, []byte("test-secret"))
	_, _ = h.Write([]byte("42"))
	wantPath := "/merged-sub/42/" + hex.EncodeToString(h.Sum(nil))
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != wantPath || r.URL.Query().Get("status") != "1" {
			t.Errorf("unexpected status URL: %s", r.URL.Path)
		}
		if r.Header.Get("Accept") != "application/json" {
			t.Error("status request must ask for JSON")
		}
		_, _ = w.Write([]byte(`{"days":0,"active":false,"expires_at":"2026-10-20T12:00:00Z","checked_at":"2026-10-21T12:00:00Z"}`))
	}))
	defer server.Close()
	a := &app{mergedBase: server.URL, mergedSecret: "test-secret"}
	got, err := a.subscriptionStatus(context.Background(), "42")
	if err != nil || got.Days != 0 || got.Active || got.ExpiresAt == nil || got.ExpiresAt.Format("2006-01-02") != "2026-10-20" {
		t.Fatalf("real expired state was not preserved: %+v %v", got, err)
	}
}

func TestSubscriptionStatusDoesNotInventDatesOnFailure(t *testing.T) {
	for _, response := range []struct {
		code int
		body string
	}{
		{404, "old bot without status endpoint"}, {503, "panel unavailable"}, {200, "{}"}, {200, "<html>login</html>"},
	} {
		server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			w.WriteHeader(response.code)
			_, _ = w.Write([]byte(response.body))
		}))
		a := &app{mergedBase: server.URL, mergedSecret: "secret"}
		_, err := a.subscriptionStatus(context.Background(), "42")
		server.Close()
		if err == nil {
			t.Fatalf("expected unavailable state for %d %s", response.code, response.body)
		}
		if strings.Contains(err.Error(), "/merged-sub/") {
			t.Fatal("signed subscription token must not appear in error logs")
		}
	}
}
