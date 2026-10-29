package main

import (
	"context"
	"crypto/hmac"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"net/http/httptest"
	"net/textproto"
	"net/url"
	"os"
	"sort"
	"strconv"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
)

func signedInitData(token, id string, when time.Time) string {
	v := url.Values{"auth_date": {strconv.FormatInt(when.Unix(), 10)}, "user": {`{"id":` + id + `,"username":"auth_test"}`}, "query_id": {"test-query"}, "signature": {"test-signature"}}
	keys := make([]string, 0, len(v))
	for k := range v {
		keys = append(keys, k)
	}
	sort.Strings(keys)
	parts := make([]string, 0, len(keys))
	for _, k := range keys {
		parts = append(parts, k+"="+v.Get(k))
	}
	secret := hmac.New(sha256.New, []byte("WebAppData"))
	secret.Write([]byte(token))
	mac := hmac.New(sha256.New, secret.Sum(nil))
	mac.Write([]byte(strings.Join(parts, "\n")))
	v.Set("hash", hex.EncodeToString(mac.Sum(nil)))
	return v.Encode()
}

func TestMiniAppSignedDataWithoutEmailOrCookie(t *testing.T) {
	a := &app{botToken: "test-token"}
	init := signedInitData(a.botToken, "5550418384", time.Now())
	user, err := a.validateTelegramWebAppInitData(init)
	if err != nil || user.ID != "5550418384" {
		t.Fatalf("valid initData rejected: %v", err)
	}
	r := httptest.NewRequest("GET", "/api/me", nil)
	r.Header.Set("Authorization", "tma "+init)
	w := httptest.NewRecorder()
	a.requireAuth(func(w http.ResponseWriter, r *http.Request, id string) {
		if id != user.ID {
			t.Fatalf("wrong Telegram identity: %s", id)
		}
		w.WriteHeader(200)
	})(w, r)
	if w.Code != 200 {
		t.Fatalf("cookie-free Mini App returned %d", w.Code)
	}
}

func TestMiniAppRejectsForgedExpiredAndDuplicateData(t *testing.T) {
	a := &app{botToken: "correct-token"}
	valid := signedInitData(a.botToken, "42", time.Now())
	for _, data := range []string{
		signedInitData("wrong-token", "42", time.Now()),
		signedInitData(a.botToken, "42", time.Now().Add(-25*time.Hour)),
		signedInitData(a.botToken, "42", time.Now().Add(10*time.Minute)),
		valid + "&user=forged", "", strings.Repeat("x", 16385),
	} {
		if _, err := a.validateTelegramWebAppInitData(data); err == nil {
			t.Fatal("invalid data accepted")
		}
	}
	if _, err := (&app{}).validateTelegramWebAppInitData(signedInitData("", "42", time.Now())); err == nil {
		t.Fatal("empty bot token accepted")
	}
	r := httptest.NewRequest("GET", "/api/me", nil)
	r.Header.Set("Authorization", "tma forged")
	r.AddCookie(&http.Cookie{Name: "nvpn_session", Value: "old-account"})
	w := httptest.NewRecorder()
	a.requireAuth(func(http.ResponseWriter, *http.Request, string) { t.Fatal("forged Telegram data fell back to cookie") })(w, r)
	if w.Code != 401 {
		t.Fatalf("got %d", w.Code)
	}
}

func TestAuthRateLimitAndTrustedProxy(t *testing.T) {
	l := authRateLimits{}
	now := time.Now()
	if !l.allow("a", 2, time.Minute, now) || !l.allow("a", 2, time.Minute, now) || l.allow("a", 2, time.Minute, now) {
		t.Fatal("limit not enforced")
	}
	if !l.allow("a", 2, time.Minute, now.Add(time.Minute)) {
		t.Fatal("limit did not expire")
	}
	r := httptest.NewRequest("POST", "/", nil)
	r.Header.Set("X-Real-IP", "203.0.113.9")
	r.RemoteAddr = "198.51.100.2:1234"
	if authClientIP(r) != "198.51.100.2" {
		t.Fatal("untrusted forwarding accepted")
	}
	r.RemoteAddr = "127.0.0.1:1234"
	if authClientIP(r) != "203.0.113.9" {
		t.Fatal("local proxy ignored")
	}
}

func TestMailFailureNeverBecomesSuccessOrLeaksCode(t *testing.T) {
	t.Setenv("SMTP_HOST", "")
	if err := sendLoginCode(context.Background(), "test@example.invalid", "123456"); err == nil {
		t.Fatal("missing SMTP returned success")
	}
	if got := mailErrorCategory(&textproto.Error{Code: 535, Msg: "sensitive text 123456"}); got != "smtp_status_535" {
		t.Fatal(got)
	}
}

func integrationApp(t *testing.T) *app {
	t.Helper()
	dsn := os.Getenv("AUTH_TEST_DATABASE_DSN")
	if dsn == "" {
		t.Skip("AUTH_TEST_DATABASE_DSN not provided (use an isolated test database)")
	}
	cfg, err := pgxpool.ParseConfig(dsn)
	if err != nil {
		t.Fatal(err)
	}
	if !strings.HasPrefix(cfg.ConnConfig.Database, "neuravpn_auth_test") {
		t.Fatal("integration tests require an isolated neuravpn_auth_test database")
	}
	schema := fmt.Sprintf("auth_%d", time.Now().UnixNano())
	admin, err := pgxpool.New(context.Background(), dsn)
	if err != nil {
		t.Fatal(err)
	}
	if _, err = admin.Exec(context.Background(), "CREATE SCHEMA "+schema); err != nil {
		t.Fatal(err)
	}
	cfg.ConnConfig.RuntimeParams["search_path"] = schema
	// A transaction must not acquire a second pool connection to finish login.
	cfg.MaxConns = 1
	pool, err := pgxpool.NewWithConfig(context.Background(), cfg)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() {
		pool.Close()
		admin.Exec(context.Background(), "DROP SCHEMA "+schema+" CASCADE")
		admin.Close()
	})
	_, err = pool.Exec(context.Background(), `CREATE TABLE users(id TEXT PRIMARY KEY,email TEXT,verified_email TEXT,verified_email_at TIMESTAMPTZ,days BIGINT NOT NULL DEFAULT 0,created_at TIMESTAMPTZ DEFAULT NOW(),updated_at TIMESTAMPTZ,last_deduct TIMESTAMPTZ)`)
	if err != nil {
		t.Fatal(err)
	}
	a := &app{db: pool, authSecret: []byte("test-secret"), botToken: "test-token", botUsername: "test_bot"}
	if err = a.initSchema(context.Background()); err != nil {
		t.Fatal(err)
	}
	return a
}

func postAuth(handler http.HandlerFunc, path, body string) *httptest.ResponseRecorder {
	r := httptest.NewRequest("POST", path, strings.NewReader(body))
	r.RemoteAddr = "127.0.0.1:1234"
	w := httptest.NewRecorder()
	handler(w, r)
	return w
}

func TestAuthIntegrationEmailDeliveryAndAtomicConsumption(t *testing.T) {
	a := integrationApp(t)
	a.db.Exec(context.Background(), `INSERT INTO users(id,email,verified_email)VALUES('42','verified@example.invalid','verified@example.invalid'),('43','unverified@example.invalid',NULL)`)
	sends := 0
	code := ""
	a.sendCode = func(_ context.Context, email, value string) error { sends++; code = value; return nil }
	w := postAuth(a.handleRequestCode, "/api/auth/request-code", `{"email":"unverified@example.invalid"}`)
	if w.Code != 422 || sends != 0 {
		t.Fatalf("unverified email: %d sends=%d", w.Code, sends)
	}
	w = postAuth(a.handleRequestCode, "/api/auth/request-code", `{"email":"verified@example.invalid"}`)
	if w.Code != 200 || sends != 1 {
		t.Fatalf("send: %d %s", w.Code, w.Body.String())
	}
	w = postAuth(a.handleRequestCode, "/api/auth/request-code", `{"email":"verified@example.invalid"}`)
	if w.Code != 429 || sends != 1 {
		t.Fatalf("resend: %d sends=%d", w.Code, sends)
	}
	body := fmt.Sprintf(`{"email":"verified@example.invalid","code":%q}`, code)
	statuses := make(chan int, 2)
	var wg sync.WaitGroup
	for i := 0; i < 2; i++ {
		wg.Add(1)
		go func() { defer wg.Done(); statuses <- postAuth(a.handleVerifyCode, "/api/auth/verify-code", body).Code }()
	}
	wg.Wait()
	close(statuses)
	counts := map[int]int{}
	for status := range statuses {
		counts[status]++
	}
	if counts[200] != 1 || counts[401] != 1 {
		t.Fatalf("OTP consumed more than once: %v", counts)
	}
}

func TestAuthIntegrationSMTPFailureAndTelegramMiniApp(t *testing.T) {
	a := integrationApp(t)
	a.db.Exec(context.Background(), `INSERT INTO users(id,email,verified_email)VALUES('42','verified@example.invalid','verified@example.invalid')`)
	a.sendCode = func(context.Context, string, string) error { return errors.New("SMTP failed") }
	w := postAuth(a.handleRequestCode, "/api/auth/request-code", `{"email":"verified@example.invalid"}`)
	if w.Code != 502 {
		t.Fatalf("SMTP failure returned %d", w.Code)
	}
	var codes int
	a.db.QueryRow(context.Background(), `SELECT COUNT(*) FROM email_login_codes`).Scan(&codes)
	if codes != 0 {
		t.Fatal("undelivered code persisted")
	}
	body, _ := json.Marshal(map[string]string{"init_data": signedInitData(a.botToken, "5550418384", time.Now())})
	w = postAuth(a.handleTelegramWebAppAuth, "/api/auth/telegram-webapp", string(body))
	if w.Code != 200 {
		t.Fatalf("Mini App failed without email: %d %s", w.Code, w.Body.String())
	}
	var email *string
	if err := a.db.QueryRow(context.Background(), `SELECT verified_email FROM users WHERE id='5550418384'`).Scan(&email); err != nil || email != nil {
		t.Fatalf("unexpected email requirement: %v", err)
	}
	a.db.Close()
	r := httptest.NewRequest("GET", "/api/me", nil)
	r.AddCookie(&http.Cookie{Name: "nvpn_session", Value: "valid-session"})
	w = httptest.NewRecorder()
	a.requireAuth(func(http.ResponseWriter, *http.Request, string) { t.Fatal("unexpected handler") })(w, r)
	if w.Code != 503 || len(w.Result().Cookies()) != 0 {
		t.Fatalf("DB outage cleared session: %d cookies=%v", w.Code, w.Result().Cookies())
	}
}

func TestAuthIntegrationBotLoginSupportsOriginalAndReturnTab(t *testing.T) {
	a := integrationApp(t)
	w := postAuth(a.handleTelegramLoginStart, "/api/auth/telegram/start", `{}`)
	var result struct {
		Token string `json:"token"`
	}
	if w.Code != 200 || json.Unmarshal(w.Body.Bytes(), &result) != nil || result.Token == "" {
		t.Fatal("start failed")
	}
	body := fmt.Sprintf(`{"token":%q}`, result.Token)
	w = postAuth(a.handleTelegramLoginCheck, "/api/auth/telegram/check", body)
	if w.Code != 200 || !strings.Contains(w.Body.String(), `"confirmed":false`) {
		t.Fatal("unconfirmed login accepted")
	}
	a.db.Exec(context.Background(), `INSERT INTO users(id)VALUES('42')`)
	a.db.Exec(context.Background(), `UPDATE web_login_tokens SET user_id='42',confirmed_at=NOW() WHERE token_hash=$1`, sessionHash(result.Token))
	for i := 0; i < 2; i++ {
		w = postAuth(a.handleTelegramLoginCheck, "/api/auth/telegram/check", body)
		if w.Code != 200 || len(w.Result().Cookies()) == 0 {
			t.Fatalf("browser %d could not finish: %d", i, w.Code)
		}
	}
}
