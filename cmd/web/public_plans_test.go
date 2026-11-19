package main

import (
	"testing"
	"time"
)

func TestBuildPublicPlansWithoutSale(t *testing.T) {
	body := buildPublicPlans(nil)
	if body.Sale != nil {
		t.Fatalf("unexpected sale: %+v", body.Sale)
	}
	if len(body.Plans) != len(plans) {
		t.Fatalf("got %d plans, want %d", len(body.Plans), len(plans))
	}
	for i, p := range body.Plans {
		if p.Amount != plans[i].Amount || p.Original != 0 {
			t.Fatalf("plan %s: amount %.2f original %.2f", p.ID, p.Amount, p.Original)
		}
	}
}

func TestBuildPublicPlansAppliesSale(t *testing.T) {
	ends := time.Now().Add(time.Hour)
	body := buildPublicPlans(&activePromo{AllProducts: true, Code: "Чёрная пятница", Discount: 20, Until: ends})
	if body.Sale == nil || body.Sale.Percent != 20 || !body.Sale.EndsAt.Equal(ends) {
		t.Fatalf("sale not exposed: %+v", body.Sale)
	}
	first := body.Plans[0]
	if first.Original != plans[0].Amount || first.Amount != saleAmount(plans[0].Amount, 20) {
		t.Fatalf("30d: amount %.2f original %.2f", first.Amount, first.Original)
	}
}
