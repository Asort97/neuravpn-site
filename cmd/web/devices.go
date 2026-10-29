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
	Devices []webDevice `json:"devices"`
	Partial bool        `json:"partial"`
	Result  string      `json:"result"`
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
	if (action == "list" && r.Method != http.MethodGet) || (action == "delete" && r.Method != http.MethodPost) {
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
	result, err := a.fetchDevices(r.Context(), userID, action, id)
	if err != nil {
		writeJSON(w, http.StatusServiceUnavailable, errResp("Не удалось получить ответ от панелей. Обновите список устройств."))
		return
	}
	writeJSON(w, http.StatusOK, result)
}
