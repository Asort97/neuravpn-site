package main

import (
	"net/http"
	"sync"
	"time"
)

// Public plan prices for the landing page: base plans with the global sale
// applied. No user data, no promocodes. Cached briefly so anonymous traffic
// never reaches the database more than once per interval.

const publicPlansTTL = 30 * time.Second

type publicPlan struct {
	ID       string  `json:"id"`
	Title    string  `json:"title"`
	Days     int     `json:"days"`
	Amount   float64 `json:"amount"`
	Original float64 `json:"original,omitempty"`
}

type publicSale struct {
	Name    string    `json:"name"`
	Percent int       `json:"percent"`
	EndsAt  time.Time `json:"ends_at"`
}

type publicPlansBody struct {
	Plans []publicPlan `json:"plans"`
	Sale  *publicSale  `json:"sale,omitempty"`
}

var publicPlansCache struct {
	sync.Mutex
	body    publicPlansBody
	expires time.Time
}

func buildPublicPlans(sale *activePromo) publicPlansBody {
	body := publicPlansBody{Plans: make([]publicPlan, 0, len(plans))}
	if sale != nil {
		body.Sale = &publicSale{Name: sale.Code, Percent: sale.Discount, EndsAt: sale.Until}
	}
	for _, p := range plans {
		item := publicPlan{ID: p.ID, Title: p.Title, Days: p.Days, Amount: p.Amount}
		if sale != nil {
			if discounted := saleAmount(p.Amount, sale.Discount); discounted < p.Amount {
				item.Original = p.Amount
				item.Amount = discounted
			}
		}
		body.Plans = append(body.Plans, item)
	}
	return body
}

func (a *app) handlePublicPlans(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet && r.Method != http.MethodHead {
		writeJSON(w, http.StatusMethodNotAllowed, errResp("method not allowed"))
		return
	}
	publicPlansCache.Lock()
	defer publicPlansCache.Unlock()
	now := time.Now()
	if now.After(publicPlansCache.expires) {
		sale, err := a.activeSale(r.Context())
		if err != nil {
			// Base prices are still true without the sale; never fail the landing page.
			sale = nil
		}
		publicPlansCache.body = buildPublicPlans(sale)
		ttl := publicPlansTTL
		if err != nil {
			ttl = 5 * time.Second
		}
		publicPlansCache.expires = now.Add(ttl)
	}
	w.Header().Set("Cache-Control", "public, max-age=30")
	writeJSON(w, http.StatusOK, publicPlansCache.body)
}
