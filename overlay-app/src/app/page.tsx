"use client";
import React, { useEffect, useState, useRef } from "react";
import "./overlay.css";

const fetchOverlayData = async () => {
  const res = await fetch("/api/overlay");
  return (await res.json())?.value || {};
};
const fetchSettings = async () => {
  const res = await fetch("/api/settings");
  return (await res.json())?.value || {};
};

export default function Overlay() {
  const [settings, setSettings] = useState({
    showTime: true,
    showLocation: true,
    showWeather: true,
    showSpeed: true,
    locationPrecision: "city_country",
  });
  const [data, setData] = useState({
    time: "",
    location: "",
    weather: { temp: "", icon: "", desc: "" },
    speed: "",
    flag: "",
  });
  const [overlayShow, setOverlayShow] = useState(false);
  const intervalRef = useRef<NodeJS.Timeout | null>(null);

  // Poll for settings and overlay data
  useEffect(() => {
    let mounted = true;
    const poll = async () => {
      const [s, d] = await Promise.all([fetchSettings(), fetchOverlayData()]);
      if (mounted) {
        setSettings({ ...settings, ...s });
        setData({ ...data, ...d });
        setOverlayShow(true);
      }
    };
    poll();
    intervalRef.current = setInterval(poll, 5000);
    return () => {
      mounted = false;
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
    // eslint-disable-next-line
  }, []);

  return (
    <div id="overlay" className={overlayShow ? "show" : ""}>
      {settings.showTime && <div id="time">{data.time}</div>}
      {settings.showLocation && (
        <div id="location">
          {data.location}
          {data.flag && <img className="flag" src={data.flag} alt="flag" />}
        </div>
      )}
      {settings.showWeather && (
        <div id="weather">
          <div className="temp">
            {data.weather.icon && (
              <img
                src={`https://openweathermap.org/img/wn/${data.weather.icon}@2x.png`}
                alt="weather icon"
                className={data.weather.icon ? "loaded" : ""}
              />
            )}
            {data.weather.temp && <span>{data.weather.temp}&deg;C</span>}
          </div>
          {data.weather.desc && <div className="desc">{data.weather.desc}</div>}
        </div>
      )}
      {settings.showSpeed && (
        <div id="speed" className={!data.speed ? "hidden" : undefined}>
          {data.speed || "0.0 km/h"}
        </div>
      )}
    </div>
  );
}
