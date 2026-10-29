package main

import (
	"context"
	"crypto/tls"
	"errors"
	"fmt"
	"log"
	"mime"
	"net"
	"net/http"
	"net/smtp"
	"net/textproto"
	"os"
	"strings"
	"sync"
	"time"
)

type authRateEntry struct {
	until time.Time
	count int
}

type authRateLimits struct {
	mu      sync.Mutex
	entries map[string]authRateEntry
}

func (l *authRateLimits) allow(key string, max int, window time.Duration, now time.Time) bool {
	l.mu.Lock()
	defer l.mu.Unlock()
	if l.entries == nil {
		l.entries = make(map[string]authRateEntry)
	}
	if len(l.entries) >= 10000 {
		for k, value := range l.entries {
			if !now.Before(value.until) {
				delete(l.entries, k)
			}
		}
		if len(l.entries) >= 10000 {
			return false
		}
	}
	entry := l.entries[key]
	if !now.Before(entry.until) {
		entry = authRateEntry{until: now.Add(window)}
	}
	if entry.count >= max {
		return false
	}
	entry.count++
	l.entries[key] = entry
	return true
}

func authClientIP(r *http.Request) string {
	host, _, err := net.SplitHostPort(r.RemoteAddr)
	if err != nil {
		host = r.RemoteAddr
	}
	// Only the loopback reverse proxy may supply the real client address.
	if ip := net.ParseIP(host); ip != nil && ip.IsLoopback() {
		if forwarded := net.ParseIP(r.Header.Get("X-Real-IP")); forwarded != nil {
			return forwarded.String()
		}
	}
	return host
}

func (a *app) allowAuthRequest(w http.ResponseWriter, r *http.Request, kind string, limit int, window time.Duration) bool {
	if a.authLimits.allow(kind+":"+authClientIP(r), limit, window, time.Now()) {
		return true
	}
	w.Header().Set("Retry-After", "60")
	writeJSON(w, http.StatusTooManyRequests, map[string]any{"error": "Слишком много запросов. Подождите немного и повторите.", "retry_after": 60})
	return false
}

func (a *app) authUnavailable(w http.ResponseWriter, operation string, err error) {
	log.Printf("web auth temporarily unavailable operation=%s: %v", operation, err)
	w.Header().Set("Retry-After", "2")
	writeJSON(w, http.StatusServiceUnavailable, errResp("Сервис входа временно недоступен. Повторите попытку."))
}

func mailErrorCategory(err error) string {
	var smtpErr *textproto.Error
	if errors.As(err, &smtpErr) {
		return fmt.Sprintf("smtp_status_%d", smtpErr.Code)
	}
	var networkErr net.Error
	if errors.As(err, &networkErr) && networkErr.Timeout() {
		return "smtp_timeout"
	}
	if errors.Is(err, context.DeadlineExceeded) {
		return "smtp_timeout"
	}
	return "smtp_unavailable"
}

func sendLoginCode(ctx context.Context, email, code string) error {
	host := strings.TrimSpace(os.Getenv("SMTP_HOST"))
	user := strings.TrimSpace(os.Getenv("SMTP_USER"))
	pass := os.Getenv("SMTP_PASS")
	from := strings.TrimSpace(os.Getenv("SMTP_FROM"))
	port := envOrDefault("SMTP_PORT", "587")
	if host == "" || user == "" || pass == "" {
		return errors.New("SMTP is not configured")
	}
	if from == "" {
		from = user
	}
	if strings.ContainsAny(from+email, "\r\n") {
		return errors.New("invalid mail address")
	}
	ctx, cancel := context.WithTimeout(ctx, 12*time.Second)
	defer cancel()
	conn, err := (&net.Dialer{}).DialContext(ctx, "tcp", net.JoinHostPort(host, port))
	if err != nil {
		return err
	}
	defer conn.Close()
	if deadline, ok := ctx.Deadline(); ok {
		_ = conn.SetDeadline(deadline)
	}
	rawConn := conn
	stop := context.AfterFunc(ctx, func() { _ = rawConn.Close() })
	defer stop()
	tlsConfig := &tls.Config{ServerName: host, MinVersion: tls.VersionTLS12}
	if port == "465" {
		tlsConn := tls.Client(conn, tlsConfig)
		if err := tlsConn.HandshakeContext(ctx); err != nil {
			return err
		}
		conn = tlsConn
	}
	client, err := smtp.NewClient(conn, host)
	if err != nil {
		return err
	}
	defer client.Close()
	if port != "465" {
		if ok, _ := client.Extension("STARTTLS"); !ok {
			return errors.New("SMTP requires STARTTLS")
		}
		if err := client.StartTLS(tlsConfig); err != nil {
			return err
		}
	}
	if err := client.Auth(smtp.PlainAuth("", user, pass, host)); err != nil {
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
	subject := mime.QEncoding.Encode("UTF-8", "neuravpn код от личного кабинета")
	body := "Никому не сообщайте код для входа: " + code + "\r\nКод действует 10 минут.\r\nПоддержка: https://t.me/neuravpn_support\r\n"
	_, err = fmt.Fprintf(wc, "From: %s\r\nTo: %s\r\nSubject: %s\r\nMIME-Version: 1.0\r\nContent-Type: text/plain; charset=UTF-8\r\n\r\n%s", from, email, subject, body)
	closeErr := wc.Close()
	if err != nil {
		return err
	}
	if closeErr != nil {
		return closeErr
	}
	// DATA acceptance means delivered to the SMTP server; a failed QUIT must not trigger another code.
	return nil
}
