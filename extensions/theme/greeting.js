/* Home greeting: replaces the page title on /home ("Home") with a phrase that follows the
   time of day. {name} is the display name, or the username when none is set. A phrase is
   picked once per page load so it doesn't flicker when Roblox re-renders the heading. */
(() => {
  const POOLS = {
    morning: [
      "Good morning, {name}!", "Rise and shine, {name}!", "Morning, {name}. Ready to create?",
      "Fresh day, fresh ideas, {name}.", "Coffee first, then Roblox, {name}?", "Early start, {name}!",
      "Top of the morning, {name}!", "Good morning, {name}. What are we building today?",
      "New day, new builds, {name}.", "Up and at 'em, {name}!", "Hope you slept well, {name}!",
      "Morning, {name}! Anything good in the queue?", "Let's make today count, {name}.",
      "Bright and early, {name}!", "Good morning, {name}. Time to play?", "Hey {name}, the day is yours.",
      "Wakey wakey, {name}!", "Morning, {name}. The servers are warm.", "A fresh start, {name}.",
      "Hello sunshine, {name}!", "Good morning, {name}. Let's get to it.", "Ready for a great day, {name}?",
      "Breakfast of champions, {name}?", "Morning, {name}! Your friends are waking up too.",
      "Another day, another game, {name}.",
    ],
    afternoon: [
      "Good afternoon, {name}!", "Afternoon, {name}. What's the plan?", "Back to creating, {name}?",
      "Hey {name}, how's your day going?", "Lunch break game, {name}?", "Good afternoon, {name}. Let's play.",
      "Midday boost, {name}!", "Hope the day is treating you well, {name}.", "Afternoon, {name}! Anything new?",
      "Time for a quick round, {name}?", "Welcome back, {name}!", "Still going strong, {name}?",
      "Good afternoon, {name}. Build something great.", "Afternoon vibes, {name}.",
      "Prime time for a game, {name}!", "How's the afternoon, {name}?", "Hey {name}, let's get into it.",
      "Good to see you, {name}!", "Make the afternoon count, {name}.", "Pick up where you left off, {name}?",
    ],
    evening: [
      "Good evening, {name}!", "Evening, {name}. Ready to unwind?", "Welcome back, {name}. Evening session?",
      "Hey {name}, long day?", "Prime time, {name}!", "Good evening, {name}. Let's play.",
      "Evening, {name}! Friends are online.", "Time to relax, {name}.", "The evening is yours, {name}.",
      "Back to creating, {name}?", "Good evening, {name}. What's on tonight?", "Dinner done? Game time, {name}!",
      "Evening, {name}. Let's make it a good one.", "Hello again, {name}!", "Winding down or gearing up, {name}?",
      "Good evening, {name}. The lobby awaits.", "Perfect time for a game, {name}.",
      "Evening, {name}! One more round?", "Hey {name}, glad you're here.", "Cozy night ahead, {name}?",
    ],
    night: [
      "Burning the midnight oil, {name}?", "Night owl mode, {name}!", "Still up, {name}?",
      "Good night, {name}... or one more game?", "Late night session, {name}?", "The night is young, {name}.",
      "Can't sleep, {name}?", "Quiet servers tonight, {name}.", "Just one more round, {name}?",
      "Midnight builder, {name}!", "Hey night owl, {name}!", "It's late, {name}. Don't forget to rest!",
      "The late shift, {name}?", "Moonlight and Roblox, {name}.", "Welcome to the night shift, {name}.",
      "Sleep is optional, {name}!", "Burning daylight at night, {name}?", "After-hours, {name}!",
      "Everyone else is asleep, {name}.", "Still creating, {name}?",
    ],
    any: [
      "How ya doin', {name}?", "Welcome back, {name}!", "Hey there, {name}!", "Good to see you, {name}.",
      "Ready when you are, {name}.", "What's the move, {name}?", "Let's go, {name}!", "Hi {name}!",
      "Look who's back: {name}!", "What are we playing, {name}?",
    ],
  };

  function bucket(hour) {
    if (hour >= 5 && hour < 12) return "morning";
    if (hour >= 12 && hour < 17) return "afternoon";
    if (hour >= 17 && hour < 22) return "evening";
    return "night";
  }

  function userName() {
    const meta = document.querySelector('meta[name="user-data"]');
    if (!meta) return "";
    return (meta.dataset.displayname || "").trim() || (meta.dataset.name || "").trim();
  }

  let phrase = "";
  function pick(name) {
    if (phrase) return phrase;
    const pool = POOLS[bucket(new Date().getHours())].concat(POOLS.any);
    phrase = pool[Math.floor(Math.random() * pool.length)].replace("{name}", name);
    return phrase;
  }

  function apply() {
    if (location.pathname.replace(/\/+$/, "") !== "/home") return;
    if (!document.documentElement.classList.contains("rocreate-on")) return;
    const name = userName();
    if (!name) return;
    // The page title is "Home" for some accounts and "Pick up where you left off" for others;
    // either way it's the first <h1> outside the sidebar, dialogs and footer.
    const skip = '.left-nav, [role="dialog"], [class*="dialog"], [class*="modal"], footer, #header';
    const marked = document.querySelector("[data-rc-greeting]");
    if (marked) {
      if (marked.textContent !== phrase) marked.textContent = phrase;
      return;
    }
    const title = [...document.querySelectorAll("h1")].find((h) => !h.closest(skip) && h.textContent.trim());
    if (title) {
      title.dataset.rcGreeting = "1";
      title.textContent = pick(name);
    }
  }

  let timer = 0;
  const queue = () => {
    if (!timer) timer = setTimeout(() => { timer = 0; apply(); }, 120);
  };

  function start() {
    new MutationObserver(queue).observe(document.body, { childList: true, subtree: true, characterData: true });
    apply();
  }
  if (document.body) start();
  else {
    new MutationObserver((_, obs) => {
      if (!document.body) return;
      obs.disconnect();
      start();
    }).observe(document, { childList: true, subtree: true });
  }
})();
