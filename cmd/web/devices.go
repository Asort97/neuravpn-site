package main

import (
	"bytes"
	"context"
	"crypto/hmac"
	"crypto/rand"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"io"
	"net"
	"net/http"
	"net/url"
	"strconv"
	"time"

	"github.com/jackc/pgx/v5"
)

const webDevicesPath = "/internal/web/devices"

func webDevicesMAC(secret, message string) string {
	key := hmac.New(sha256.New, []byte(secret))
	key.Write([]byte("neuravpn-web-devices-v1"))
	mac := hmac.New(sha256.New, key.Sum(nil))
	mac.Write([]byte(message))
	return hex.EncodeToString(mac.Sum(nil))
}

type webDevice struct {
	ID       string `json:"id"`
	Name     string `json:"name"`
	LastSeen int64  `json:"last_seen"`
}

type webDeviceList struct {
	Devices    []webDevice  `json:"devices"`
	Partial    bool         `json:"partial"`
	Result     string       `json:"result"`
	DevicePlan devicePlan   `json:"device_plan"`
	Order      *deviceOrder `json:"order,omitempty"`
}

type devicePlan struct {
	Enabled    bool `json:"enabled"`
	ExtraSlots int  `json:"extra_slots"`
}
type deviceOrder struct {
	ID      string `json:"id"`
	URL     string `json:"confirmation_url,omitempty"`
	Applied bool   `json:"applied"`
}

func (a *app) devicePlan(ctx context.Context, userID string) (devicePlan, error) {
	var p devicePlan
	err := a.db.QueryRow(ctx, `SELECT enabled,extra_slots FROM device_plans WHERE user_id=$1`, userID).Scan(&p.Enabled, &p.ExtraSlots)
	if errors.Is(err, pgx.ErrNoRows) {
		return p, nil
	}
	return p, err
}

func (a *app) enableAutopayWithDevices(ctx context.Context, userID string, expected int) (string, error) {
	tx, err := a.db.Begin(ctx)
	if err != nil {
		return "", err
	}
	defer tx.Rollback(ctx)
	var extra int
	err = tx.QueryRow(ctx, `SELECT extra_slots FROM device_plans WHERE user_id=$1 FOR UPDATE`, userID).Scan(&extra)
	if err != nil && !errors.Is(err, pgx.ErrNoRows) {
		return "", err
	}
	if extra != expected {
		return "", errors.New("device price changed")
	}
	var planID string
	err = tx.QueryRow(ctx, `UPDATE users SET autopay_enabled=TRUE,updated_at=NOW() WHERE id=$1 AND COALESCE(autopay_method_id,'')<>'' AND COALESCE(autopay_plan_id,'')<>'' RETURNING autopay_plan_id`, userID).Scan(&planID)
	if err != nil {
		return "", err
	}
	return planID, tx.Commit(ctx)
}

func (a *app) fetchDevices(ctx context.Context, userID, action, id string) (webDeviceList, error) {
	var result webDeviceList
	endpoint := envOrDefault("BOT_WEB_DEVICES_URL", "http://127.0.0.1:8080"+webDevicesPath)
	u, err := url.Parse(endpoint)
	if err != nil {
		return result, err
	}
	ip := net.ParseIP(u.Hostname())
	if u.Scheme != "http" || ip == nil || !ip.IsLoopback() || u.Path != webDevicesPath || u.RawQuery != "" || u.User != nil || a.botToken == "" {
		return result, errors.New("invalid local devices endpoint")
	}
	body, _ := json.Marshal(map[string]string{"user_id": userID, "action": action, "id": id})
	ctx, cancel := context.WithTimeout(ctx, 18*time.Second)
	defer cancel()
	r, err := http.NewRequestWithContext(ctx, http.MethodPost, endpoint, bytes.NewReader(body))
	if err != nil {
		return result, err
	}
	var nonce [16]byte
	if _, err = rand.Read(nonce[:]); err != nil {
		return result, err
	}
	stamp, nonceHex := strconv.FormatInt(time.Now().Unix(), 10), hex.EncodeToString(nonce[:])
	r.Header.Set("Content-Type", "application/json")
	r.Header.Set("X-Device-Time", stamp)
	r.Header.Set("X-Device-Nonce", nonceHex)
	r.Header.Set("X-Device-Signature", webDevicesMAC(a.botToken, "POST\n"+webDevicesPath+"\n"+stamp+"\n"+nonceHex+"\n"+string(body)))
	client := &http.Client{Timeout: 18 * time.Second, CheckRedirect: func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse }}
	resp, err := client.Do(r)
	if err != nil {
		return result, err
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return result, errors.New("device service unavailable")
	}
	if err = json.NewDecoder(io.LimitReader(resp.Body, 1<<20)).Decode(&result); err != nil {
		return result, err
	}
	if result.Devices == nil {
		return result, errors.New("invalid device service response")
	}
	return result, nil
}

func (a *app) handleDevices(w http.ResponseWriter, r *http.Request, userID string) {
	action, id := "list", ""
	if r.URL.Path == "/api/devices/delete" {
		action = "delete"
	}
	if r.URL.Path == "/api/devices/purchase" {
		action = "purchase"
	}
	if r.URL.Path == "/api/devices/check" {
		action = "check"
	}
	if r.URL.Path == "/api/devices/reduce" {
		action = "reduce"
	}
	if (action == "list" && r.Method != http.MethodGet) || (action != "list" && r.Method != http.MethodPost) {
		writeJSON(w, http.StatusMethodNotAllowed, errResp("method not allowed"))
		return
	}
	if !a.authLimits.allow("devices:"+userID, 30, time.Minute, time.Now()) {
		writeJSON(w, http.StatusTooManyRequests, errResp("Слишком много запросов. Подождите минуту."))
		return
	}
	if action == "delete" {
		var req struct {
			ID string `json:"id"`
		}
		if readJSON(r, &req) != nil {
			writeJSON(w, 400, errResp("Некорректный запрос"))
			return
		}
		decoded, err := hex.DecodeString(req.ID)
		if err != nil || len(decoded) != 32 {
			writeJSON(w, 400, errResp("Обновите список устройств."))
			return
		}
		id = req.ID
	}
	if action == "check" {
		var req struct {
			ID string `json:"id"`
		}
		if readJSON(r, &req) != nil || len(req.ID) != 36 {
			writeJSON(w, 400, errResp("Некорректный номер платежа"))
			return
		}
		id = req.ID
	}
	result, err := a.fetchDevices(r.Context(), userID, action, id)
	if err != nil {
		writeJSON(w, http.StatusServiceUnavailable, errResp("Не удалось получить ответ от панелей. Обновите список устройств."))
		return
	}
	writeJSON(w, http.StatusOK, result)
}
