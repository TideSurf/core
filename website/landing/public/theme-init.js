(() => {
  const prefersDark = window.matchMedia("(prefers-color-scheme: dark)").matches;
  let theme = prefersDark ? "dark" : "light";

  try {
    const savedTheme = window.localStorage.getItem("tidesurf-theme");
    if (savedTheme === "dark" || savedTheme === "light") {
      theme = savedTheme;
    }
  } catch {
    // Ignore storage failures and fall back to the system preference.
  }

  document.documentElement.setAttribute("data-theme", theme);
})();
