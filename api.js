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

  async get(path) {
    const r = await fetch(API_BASE + path, { headers: this.headers() });
    return r.json();
  },

  async post(path, body) {
    const r = await fetch(API_BASE + path, {
      method:'POST', headers: this.headers(), body: JSON.stringify(body)
    });
    return r.json();
  },

  async postForm(path, formData) {
    const h = {};
    const t = this.token();
    if (t) h['Authorization'] = 'Bearer ' + t;
    const r = await fetch(API_BASE + path, { method:'POST', headers: h, body: formData });
    return r.json();
  },

  async patch(path, body) {
    const r = await fetch(API_BASE + path, {
      method:'PATCH', headers: this.headers(), body: JSON.stringify(body)
    });
    return r.json();
  },

  async delete(path) {
    const r = await fetch(API_BASE + path, { method:'DELETE', headers: this.headers() });
    return r.json();
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
