// js/api.js — Frontend API client
// AUTO-DETECTS server from same host, works on LAN too
const API_BASE = window.location.origin + '/api';

const API = {
  token: () => localStorage.getItem('wt_token'),

  headers(extra={}) {
    const h = { 'Content-Type': 'application/json', ...extra };
    const t = this.token();
    if (t) h['Authorization'] = 'Bearer ' + t;
    return h;
  },
  async handleResponse(r) {
    // Only auto-logout on auth failures if we actually have a token (prevents infinite redirect loops)
    if ((r.status === 401 || r.status === 403) && this.token()) {
      this.logout();
      return { error: 'Session expired. Please log in again.' };
    }
    const contentType = r.headers.get('content-type');
    if (contentType && contentType.includes('application/json')) {
      try {
        return await r.json();
      } catch (err) {
        return { error: 'Failed to parse server response' };
      }
    }
    const text = await r.text();
    if (text.startsWith('<!DOCTYPE html>') || text.includes('<html')) {
      return { error: 'Internal server error (returned HTML)' };
    }
    return { error: text || 'Unknown server error' };
  },

  async get(path) {
    const r = await fetch(API_BASE + path, { headers: this.headers() });
    return this.handleResponse(r);
  },

  async post(path, body) {
    const r = await fetch(API_BASE + path, {
      method:'POST', headers: this.headers(), body: JSON.stringify(body)
    });
    return this.handleResponse(r);
  },

  async postForm(path, formData) {
    const h = {};
    const t = this.token();
    if (t) h['Authorization'] = 'Bearer ' + t;
    const r = await fetch(API_BASE + path, { method:'POST', headers: h, body: formData });
    return this.handleResponse(r);
  },

  async patch(path, body) {
    const r = await fetch(API_BASE + path, {
      method:'PATCH', headers: this.headers(), body: JSON.stringify(body)
    });
    return this.handleResponse(r);
  },

  async delete(path) {
    const r = await fetch(API_BASE + path, { method:'DELETE', headers: this.headers() });
    return this.handleResponse(r);
  },

  // Auth helpers
  setSession(token, user) {
    localStorage.setItem('wt_token', token);
    localStorage.setItem('wt_user', JSON.stringify(user));
  },
  getUser() {
    const raw = localStorage.getItem('wt_user');
    return raw ? JSON.parse(raw) : null;
  },
  logout() {
    localStorage.removeItem('wt_token');
    localStorage.removeItem('wt_user');
    window.location.href = '/index.html';
  },
  isLoggedIn() { return !!this.token(); }
};

window.API = API;
