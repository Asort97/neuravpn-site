package main

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"strings"
	"time"
)

type subscriptionStatus struct {
	Days              int64      `json:"days"`
	Active            bool       `json:"active"`
	Unlimited         bool       `json:"unlimited"`
	PendingActivation bool       `json:"pending_activation"`
	ExpiresAt         *time.Time `json:"expires_at"`
	CheckedAt         time.Time  `json:"checked_at"`
}

// Use the bot's signed subscription URL so the web service needs no panel credentials.
func (a *app) subscriptionStatus(ctx context.Context, userID string) (subscriptionStatus, error) {
	var status subscriptionStatus
	if a.mergedBase == "" || a.mergedSecret == "" {
		return status, errors.New("merged subscription status is not configured")
	}
	endpoint := strings.TrimRight(a.subscriptionURL(userID, ""), "/") + "/status"
	ctx, cancel := context.WithTimeout(ctx, 10*time.Second)
	defer cancel()
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, endpoint, nil)
	if err != nil {
		return status, err
	}
	req.Header.Set("Accept", "application/json")
	req.Header.Set("Cache-Control", "no-cache")
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		return status, errors.New("bot subscription status request failed")
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return status, fmt.Errorf("bot subscription status returned %d", resp.StatusCode)
	}
	if err := json.NewDecoder(io.LimitReader(resp.Body, 64*1024)).Decode(&status); err != nil {
		return status, errors.New("invalid bot subscription status response")
	}
	if status.CheckedAt.IsZero() || status.Days < 0 || (status.Active && status.ExpiresAt == nil && !status.Unlimited && !status.PendingActivation) {
		return status, errors.New("incomplete bot subscription status response")
	}
	return status, nil
}
