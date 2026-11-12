package main

import (
	"context"
	"errors"
	"github.com/jackc/pgx/v5"
	"math"
)

const saleSchema = `CREATE TABLE IF NOT EXISTS global_sale (
 singleton BOOLEAN PRIMARY KEY DEFAULT TRUE CHECK(singleton),
 name TEXT NOT NULL, percent INTEGER NOT NULL CHECK(percent BETWEEN 1 AND 99),
 ends_at TIMESTAMPTZ NOT NULL, created_by TEXT NOT NULL,
 created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), stopped_at TIMESTAMPTZ
);`

func (a *app) activeSale(ctx context.Context) (*activePromo, error) {
	if a.db == nil {
		return nil, errors.New("database unavailable")
	}
	var s activePromo
	err := a.db.QueryRow(ctx, `SELECT name,percent,ends_at FROM global_sale WHERE singleton AND stopped_at IS NULL AND ends_at>NOW()`).Scan(&s.Code, &s.Discount, &s.Until)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, nil
	}
	s.AllProducts = true
	return &s, err
}

func saleAmount(amount float64, percent int) float64 {
	if percent < 1 || percent > 99 {
		return amount
	}
	return math.Max(1, math.Round(amount*(100-float64(percent)))/100)
}

func effectivePromotion(p plan, promo *activePromo) *activePromo {
	if p.Sale == nil {
		return promo
	}
	ordinary := p.Amount + float64(p.DeviceExtra*50)
	if promo != nil {
		ordinary = math.Round(p.Amount*(1-float64(promo.Discount)/100)*100)/100 + float64(p.DeviceExtra*50)
	}
	if saleAmount(p.Amount+float64(p.DeviceExtra*50), p.Sale.Discount) <= ordinary {
		return p.Sale
	}
	return promo
}
