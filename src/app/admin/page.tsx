"use client";
import React, { useState, useEffect } from "react";

const LOCATION_OPTIONS = [
  { value: "city_country", label: "City, Country" },
  { value: "state_country", label: "State, Country" },
  { value: "country", label: "Country Only" },
  { value: "hidden", label: "Location Hidden" },
];

type Settings = {
  showTime: boolean;
  showLocation: boolean;
  showWeather: boolean;
  showSpeed: boolean;
  locationPrecision: string;
};

export default function AdminPanel() {
  const [password, setPassword] = useState("");
  const [authed, setAuthed] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [settings, setSettings] = useState<Settings>({
    showTime: true,
    showLocation: true,
    showWeather: true,
    showSpeed: true,
    locationPrecision: "city_country",
  });

  useEffect(() => {
    if (authed) {
      fetch("/api/settings")
        .then((res) => res.json())
        .then((data) => {
          if (data?.value) setSettings(data.value);
        });
    }
  }, [authed]);

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError("");
    // Simple password check (in real app, use API route and httpOnly cookie)
    const res = await fetch("/api/admin-auth", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ password }),
    });
    if (res.ok) {
      setAuthed(true);
    } else {
      setError("Incorrect password");
    }
    setLoading(false);
  };

  const handleToggle = (key: keyof Settings) => {
    setSettings((prev) => {
      const next = { ...prev, [key]: !prev[key] };
      saveSettings(next);
      return next;
    });
  };

  const handleLocationPrecision = (e: React.ChangeEvent<HTMLSelectElement>) => {
    const next = { ...settings, locationPrecision: e.target.value };
    setSettings(next);
    saveSettings(next);
  };

  const saveSettings = async (nextSettings: Settings) => {
    await fetch("/api/settings", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(nextSettings),
    });
  };

  if (!authed) {
    return (
      <div style={{ maxWidth: 320, margin: "60px auto", padding: 24, background: "rgba(0,0,0,0.7)", borderRadius: 12, color: "#fff" }}>
        <h2>Admin Login</h2>
        <form onSubmit={handleLogin}>
          <input
            type="password"
            placeholder="Admin password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            style={{ width: "100%", padding: 8, marginBottom: 12, borderRadius: 6, border: "none" }}
          />
          <button type="submit" style={{ width: "100%", padding: 10, borderRadius: 6, background: "#2d8cff", color: "#fff", border: "none", fontWeight: 600 }} disabled={loading}>
            {loading ? "Logging in..." : "Login"}
          </button>
          {error && <div style={{ color: "#ff6b6b", marginTop: 8 }}>{error}</div>}
        </form>
      </div>
    );
  }

  return (
    <div style={{ maxWidth: 400, margin: "40px auto", padding: 24, background: "rgba(0,0,0,0.7)", borderRadius: 12, color: "#fff" }}>
      <h2>Overlay Admin</h2>
      <div style={{ marginBottom: 18 }}>
        <label style={{ display: "block", marginBottom: 6 }}>
          <input type="checkbox" checked={settings.showTime} onChange={() => handleToggle("showTime")}/> Show Time
        </label>
        <label style={{ display: "block", marginBottom: 6 }}>
          <input type="checkbox" checked={settings.showLocation} onChange={() => handleToggle("showLocation")}/> Show Location
        </label>
        <label style={{ display: "block", marginBottom: 6 }}>
          <input type="checkbox" checked={settings.showWeather} onChange={() => handleToggle("showWeather")}/> Show Weather
        </label>
        <label style={{ display: "block", marginBottom: 6 }}>
          <input type="checkbox" checked={settings.showSpeed} onChange={() => handleToggle("showSpeed")}/> Show Speed
        </label>
      </div>
      <div style={{ marginBottom: 18 }}>
        <label style={{ display: "block", marginBottom: 6 }}>Location Precision</label>
        <select value={settings.locationPrecision} onChange={handleLocationPrecision} style={{ width: "100%", padding: 8, borderRadius: 6 }}>
          {LOCATION_OPTIONS.map(opt => (
            <option key={opt.value} value={opt.value}>{opt.label}</option>
          ))}
        </select>
      </div>
    </div>
  );
} 