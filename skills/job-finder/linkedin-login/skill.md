---
name: linkedin-login
description: Handle LinkedIn authentication with stored credentials and 2FA support. Use when LinkedIn shows a login page, session expired, or user says "log into LinkedIn". Reads credentials from ~/.x-lens/.linkedin-creds, handles verification codes and CAPTCHAs with manual fallback.
triggers: [linkedin login, sign in, authenticate, logged out, linkedin credentials, login failed]
---

# LinkedIn Login

**Most runs don't need login** — persistent browser profiles save cookies across sessions. Always check login state first.

## Instructions

### Step 1: Check Login State
1. Navigate to `https://www.linkedin.com/feed/`
2. Take a screenshot

   - Expected: LinkedIn feed with posts visible, navigation bar showing "Home", "My Network", "Jobs"
   - If feed is visible: you are already logged in. Save status to memory: "LinkedIn logged in <date>". Done — skip all remaining steps.
   - If login/signup page is shown: continue to Step 2

### Step 2: Read Credentials
1. Read the credentials file: `cat ~/.x-lens/.linkedin-creds`
2. Parse the `email=` and `password=` lines

   - Expected: Two lines with `email=user@example.com` and `password=secret`
   - If file is missing or empty: tell the user to create it:
     ```
     Create ~/.x-lens/.linkedin-creds with:
     email=your@email.com
     password=yourpassword
     ```
     Then stop — cannot proceed without credentials.

### Step 3: Enter Credentials and Submit
1. Navigate to `https://www.linkedin.com/login`
2. Type email into `input#username`
3. Type password into `input#password`
4. Click `button[type="submit"]`
5. Wait 3 seconds, take a screenshot

   - Expected: LinkedIn feed loads, or a verification challenge appears
   - If feed loads: login succeeded — proceed to Step 5 (Verify)
   - If challenge appears: proceed to Step 4

CRITICAL: Do not store or log credentials in plain text in any output. Only read them from the credentials file.

### Step 4: Handle Verification Challenges
Identify which challenge is shown and follow the corresponding action:

**2FA verification code**:
1. Alert: `[ALERT] LinkedIn 2FA — check your email or phone for a verification code`
2. Wait 60 seconds, take a screenshot
3. If code entry page still shown: wait another 60 seconds, screenshot again
4. Retry up to 3 times (total 3 minutes)

   - Expected: User enters code, page redirects to feed
   - If 3 minutes pass with no code entered: use manual fallback

**CAPTCHA challenge**:
1. Alert: `[ALERT] LinkedIn CAPTCHA detected — manual login required`
2. Use manual fallback immediately

   - Expected: User completes CAPTCHA in visible browser

**"Unusual activity" warning**:
1. Alert: `[ALERT] LinkedIn flagged unusual activity — manual login required`
2. Use manual fallback immediately

**Wrong password error**:
1. Alert: `[ALERT] LinkedIn login failed — password incorrect`
2. Tell user to update `~/.x-lens/.linkedin-creds` with correct credentials
3. Stop — cannot retry with wrong password

**Manual fallback**: Run `x-lens --persona job-finder --visible` — this opens a visible browser window where the user logs in manually. Cookies persist in the browser profile at `~/.x-lens/browser-data/job-finder/` for future automated runs.

### Step 5: Verify Login
1. Navigate to `https://www.linkedin.com/feed/`
2. Take a screenshot

   - Expected: LinkedIn feed with posts visible, navigation bar present
   - If feed is visible: login succeeded. Save to memory: "LinkedIn login successful <date>". Return to the calling skill.
   - If not: use manual fallback from Step 4

## Performance Notes
- Check login state first — most runs are already logged in via persistent cookies
- Browser profile at `~/.x-lens/browser-data/job-finder/` stores cookies across sessions
- After one successful manual login with `--visible`, subsequent headless runs reuse saved cookies
- LinkedIn sessions typically last 1-2 weeks before requiring re-authentication

## Examples

### Example 1: Already logged in
User says: "Search LinkedIn for hiring posts" (linkedin-search calls this skill first)

Actions:
1. Navigate to `https://www.linkedin.com/feed/`
2. Screenshot shows feed with posts and navigation bar

Result: Already logged in — done in one step, no credentials needed

### Example 2: Login with 2FA
User says: "Log into LinkedIn"

Actions:
1. Navigate to feed → screenshot shows login page
2. Read credentials from `~/.x-lens/.linkedin-creds`
3. Enter email and password, click submit
4. Screenshot shows 2FA code entry page
5. Alert user: "[ALERT] LinkedIn 2FA — check your email or phone"
6. Wait 60 seconds → user enters code → feed loads

Result: Login successful, cookies saved for future runs

### Example 3: Session expired mid-search
linkedin-search skill encounters login page during query execution

Actions:
1. Navigate to feed → login page shown (session expired)
2. Read credentials, enter them, submit
3. Feed loads without challenge (cookies partially valid)

Result: Re-authenticated, linkedin-search resumes remaining queries

## Troubleshooting

### Credentials file not found
Cause: User hasn't created the credentials file yet
Solution: Tell user to create `~/.x-lens/.linkedin-creds` with `email=` and `password=` lines. File must exist before login can proceed.

### Login works but next run asks for login again
Cause: Browser profile directory doesn't exist or cookies aren't being persisted
Solution: Verify `~/.x-lens/browser-data/job-finder/` directory exists. If missing, the browser is using a temporary profile. Check that the daemon launches with the correct `profileDir` setting.

### "Unusual activity" detected on every login attempt
Cause: LinkedIn is flagging headless browser automation
Solution: Log in once manually using `x-lens --persona job-finder --visible`. Complete any verification challenges in the visible browser. Cookies from this session persist for future headless runs.

### 2FA code times out
Cause: User didn't enter the verification code within 3 minutes
Solution: Increase wait time or use `--visible` mode for initial login so the user can enter the code directly in the browser window.
