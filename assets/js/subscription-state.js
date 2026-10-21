(function (root) {
    function subscriptionState(me, now) {
        now = now == null ? Date.now() : now;
        const unknown = { known: false, active: false, days: null };
        if (me.subscription_verified !== true) return unknown;
        if (!me.active) return { known: true, active: false, days: 0 };
        if (me.unlimited) return { known: true, active: true, days: null, unlimited: true };
        if (me.pending_activation) {
            return Number.isFinite(me.days) && me.days > 0
                ? { known: true, active: true, days: me.days, pending: true } : unknown;
        }
        const expiry = Date.parse(me.expires_at);
        const checked = Date.parse(me.checked_at);
        if (!Number.isFinite(expiry) || !Number.isFinite(checked)) return unknown;
        const serverNow = checked + Math.max(0, now - me.received_at);
        if (!Number.isFinite(serverNow)) return unknown;
        const days = Math.max(0, Math.ceil((expiry - serverNow) / 86400000));
        return { known: true, active: days > 0, days: days };
    }
    if (typeof module !== "undefined" && module.exports) module.exports = subscriptionState;
    else root.neuravpnSubscriptionState = subscriptionState;
})(typeof window !== "undefined" ? window : this);
