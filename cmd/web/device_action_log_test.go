package main

import (
	"errors"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"
)

func TestDeviceActionLogResults(t *testing.T) {
	for _, tc := range []struct {
		action, result, want string
		failed               bool
	}{
		{"delete", "queued", "удалил устройство; выдача подписки заблокирована", false},
		{"restore", "restored", "разблокировал устройство", false},
		{"delete", "absent", "удаление устройства: запись уже отсутствует", false},
		{"restore", "absent", "разблокировка устройства: запись уже отсутствует", false},
		{"delete", "", "удаление устройства: результат не подтверждён", false},
		{"restore", "restored", "разблокировка устройства: не удалось получить подтверждение сервера", true},
	} {
		if got := deviceActionLogText(tc.action, tc.result, tc.failed); got != tc.want {
			t.Fatal(got)
		}
	}
}

func TestDeviceTrackedLogUsesSourceAndAuthenticatedOwner(t *testing.T) {
	for _, mini := range []bool{false, true} {
		source := "site"
		r := httptest.NewRequest("POST", "/api/devices/restore", nil)
		if mini {
			source = "miniapp"
			r.Header.Set("Authorization", "tma already-validated-by-middleware")
		}
		key := source + ":u:42"
		// Keep the log session in-flight so this unit test never calls Telegram.
		s := &webLogSession{Start: time.Now(), Last: time.Now(), Sending: true}
		a := &app{botToken: "test", webLogChatID: "test", webLogs: map[string]*webLogSession{key: s}}
		a.logDeviceAction(r, "42", "restore", webDeviceList{Result: "restored", ActionDevice: "<phone>\n& tablet"}, nil)
		if s.UserID != "42" || s.Source != source || len(s.Actions) != 1 || !strings.Contains(s.Actions[0], "разблокировал устройство") || !s.Dirty {
			t.Fatal(s)
		}
		if text := webLogText(s); strings.Contains(text, "<phone>") || !strings.Contains(text, "&lt;phone&gt;") {
			t.Fatal(text)
		}
		a.logDeviceAction(r, "42", "delete", webDeviceList{}, errors.New("timeout"))
		if len(s.Actions) != 2 || !strings.Contains(s.Actions[1], "не удалось получить подтверждение") {
			t.Fatal(s.Actions)
		}
	}
}

func TestDeviceHandlerRecordsResultWithoutTrustingClientName(t *testing.T) {
	for _, tc := range []struct {
		action, result, want string
		code                 int
	}{
		{"delete", "queued", "удалил устройство", 200},
		{"restore", "restored", "разблокировал устройство", 200},
		{"restore", "absent", "запись уже отсутствует", 200},
		{"delete", "", "не удалось получить подтверждение", 503},
	} {
		t.Run(tc.action+tc.result, func(t *testing.T) {
			server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				w.WriteHeader(tc.code)
				io.WriteString(w, `{"devices":[],"result":"`+tc.result+`","action_device":"server phone"}`)
			}))
			defer server.Close()
			t.Setenv("BOT_WEB_DEVICES_URL", server.URL+webDevicesPath)
			s := &webLogSession{Start: time.Now(), Last: time.Now(), Sending: true}
			a := &app{botToken: "test", webLogChatID: "test", webLogs: map[string]*webLogSession{"miniapp:u:42": s}}
			r := httptest.NewRequest("POST", "/api/devices/"+tc.action, strings.NewReader(`{"id":"`+strings.Repeat("a", 64)+`","name":"forged name","user_id":"999"}`))
			r.Header.Set("Authorization", "tma authenticated")
			w := httptest.NewRecorder()
			a.handleDevices(w, r, "42")
			if w.Code != tc.code || s.UserID != "42" || len(s.Actions) != 1 || !strings.Contains(s.Actions[0], tc.want) || strings.Contains(s.Actions[0], "forged") {
				t.Fatal(w.Code, s)
			}
			if tc.code == 200 && !strings.Contains(s.Actions[0], "server phone") {
				t.Fatal(s.Actions)
			}
		})
	}
}
