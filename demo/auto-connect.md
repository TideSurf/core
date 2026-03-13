# Auto Connect Demos

These demos use `--auto-connect` to attach to your running Chrome — the agent sees your logged-in sessions, cookies, and extensions. No re-authentication needed.

## Setup

1. **Enable remote debugging in Chrome:**
   - Navigate to `chrome://inspect#remote-debugging` and enable it (Chrome 144+), or
   - Relaunch Chrome with `--remote-debugging-port=9222`

2. **Configure TideSurf MCP with auto-connect:**
   ```json
   {
     "mcpServers": {
       "tidesurf": {
         "command": "bunx",
         "args": ["tidesurf", "mcp", "--auto-connect"]
       }
     }
   }
   ```

3. **Log into the sites you want the agent to access** in your Chrome, then use any prompt below.

---

## GitHub

### Triage my notifications

```
Check my GitHub notifications. Summarize any that need my attention —
group them by repo, and tell me which ones I can dismiss.
```

### Review a pull request

```
Go to https://github.com/<owner>/<repo>/pulls and find the most
recent open PR. Read through the changes and give me a review summary:
what it does, whether it looks correct, and anything I should watch out for.
```

### Check my repos

```
Go to https://github.com and list my pinned repositories with their
descriptions and star counts. Then check which ones have open issues.
```

---

## Google

### Summarize recent emails

```
Go to https://mail.google.com and read my 5 most recent emails.
Give me a one-line summary of each — sender, subject, and whether
it needs a reply.
```

### Check my calendar

```
Go to https://calendar.google.com and tell me what's on my schedule
for today and tomorrow. Flag any conflicts.
```

---

## Linear / Jira / Project management

### My assigned tickets

```
Go to https://linear.app and find all issues assigned to me.
Group them by status (in progress, todo, backlog) and list the
title and priority of each.
```

---

## General

### Debug a page you're looking at

```
Look at the page I currently have open. Find any accessibility
issues — missing alt text, low contrast, unlabeled form fields.
List them with the element IDs so I can fix them.
```

### Extract data from a dashboard

```
I have a dashboard open at <URL>. Extract the key metrics visible
on the page and format them as a markdown table.
```

### Fill out a form with my info

```
I have a form open. Fill it out with the following info:
- Name: ...
- Email: ...
- Company: ...
Submit it when done.
```

---

## Why auto-connect?

| Without auto-connect | With auto-connect |
|---|---|
| Fresh browser, no cookies | Your logged-in sessions |
| Can't access auth-gated pages | Full access to everything you can see |
| Agent manages Chrome lifecycle | Your Chrome, your extensions, your state |
| Good for public pages | Good for real work |
