---
name: linkedin-login
description: Handle LinkedIn authentication using stored credentials with 2FA support
triggers: [linkedin login, authenticate, sign in, credentials, logged out]
---

## Instructions

This skill handles LinkedIn authentication using stored credentials from `~/.x-lens/.linkedin-creds`. It supports 2FA prompts, CAPTCHA detection, and manual fallback.

### Step 1: Check Login State

1. Use `browser_navigate` to go to `https://www.linkedin.com/feed/`
2. Use `browser_screenshot` to capture the current page
3. If the feed is visible (you see posts, a compose box, or navigation showing "Home", "My Network", etc.), you are already logged in. Save `LinkedIn login confirmed as of <today's date>` using `memory_write` with key `linkedin_login_status` and stop here.
4. If you see a login page, signup prompt, or redirect to `/login`, proceed to Step 2.

### Step 2: Read Credentials

1. Use the shell tool to run: `cat ~/.x-lens/.linkedin-creds`
2. Parse the file for `email=` and `password=` lines (key=value format, one per line)
3. If the file does not exist or is missing required fields, notify the user:
   ```
   [ACTION REQUIRED] LinkedIn credentials file not found or incomplete.
   Please create ~/.x-lens/.linkedin-creds with the following format:

   email=your.email@example.com
   password=your_password

   Then re-run this skill.
   ```
   Stop here if credentials are unavailable.

### Step 3: Perform Login

1. Use `browser_navigate` to go to `https://www.linkedin.com/login`
2. Use `browser_screenshot` to confirm the login form is visible
3. Use `browser_click` on `input#username`, then `browser_type` to enter the email address
4. Use `browser_click` on `input#password`, then `browser_type` to enter the password
5. Use `browser_click` on `button[type="submit"]` to submit the form
6. Wait 3 seconds for the page to load
7. Use `browser_screenshot` to check the result

### Step 4: Handle Post-Login Challenges

After submitting credentials, inspect the screenshot for the following scenarios:

#### 4a. Verification Code / 2FA Prompt

If the page asks for a verification code (SMS, email, or authenticator app):

1. Send an alert to the user:
   ```
   [ALERT] LinkedIn is requesting a verification code.
   Please check your email/phone and enter the code in the browser within 60 seconds.
   ```
2. Wait 60 seconds, then use `browser_screenshot` to check if the user completed verification
3. If still on the verification page, repeat the alert and wait — up to **3 attempts** (3 minutes total)
4. If verification is still not completed after 3 attempts, notify the user:
   ```
   [FAILED] 2FA verification timed out after 3 minutes.
   Please run: x-lens --persona job-finder --visible
   and complete login manually in the visible browser window.
   ```
   Stop here.

#### 4b. CAPTCHA Challenge

If the page shows a CAPTCHA (image puzzle, "verify you're human", etc.):

1. Notify the user:
   ```
   [ACTION REQUIRED] LinkedIn is showing a CAPTCHA challenge.
   Please run: x-lens --persona job-finder --visible
   and solve the CAPTCHA manually in the visible browser window.
   ```
2. Wait 60 seconds, then use `browser_screenshot` to check if the CAPTCHA was solved
3. If CAPTCHA is still present, stop and instruct the user to complete it via `--visible` mode.

#### 4c. "Unusual Activity" or Account Restriction

If the page mentions "unusual activity", "restricted", or similar security warnings:

1. Notify the user:
   ```
   [ACTION REQUIRED] LinkedIn has flagged unusual activity on this account.
   Automated login cannot proceed. Please run:

   x-lens --persona job-finder --visible

   and log in manually in the visible browser window. The persistent browser
   profile will save your session for future automated runs.
   ```
2. Stop here.

#### 4d. Incorrect Credentials

If the page shows "wrong password", "incorrect credentials", or similar error:

1. Notify the user:
   ```
   [ERROR] LinkedIn rejected the stored credentials.
   Please update ~/.x-lens/.linkedin-creds with the correct email and password, then retry.
   ```
2. Stop here.

### Step 5: Verify Successful Login

If none of the challenge scenarios above were detected:

1. Use `browser_navigate` to go to `https://www.linkedin.com/feed/`
2. Use `browser_screenshot` to capture the page
3. If the feed is visible (posts, compose box, navigation bar), login was successful:
   - Save `LinkedIn login successful as of <today's date>` using `memory_write` with key `linkedin_login_status`
   - Report success to the caller
4. If the feed is not visible, treat it as a failed login and proceed to Step 6.

### Step 6: Manual Fallback

If automated login has failed for any reason not covered above:

1. Notify the user:
   ```
   [FAILED] Automated LinkedIn login was unsuccessful.
   Please log in manually by running:

   x-lens --persona job-finder --visible

   Log in through the visible browser window. Your session will be saved in the
   persistent browser profile, so future automated runs will not need to log in again.
   ```

### Important Notes

- **Persistent sessions**: x-lens uses Playwright with persistent browser profiles. Once logged in, cookies survive restarts, so this skill should rarely need to perform a full login.
- **Credential security**: The credentials file at `~/.x-lens/.linkedin-creds` is read only when needed. Never log or echo credential values in output.
- **Rate limiting**: Do not retry the login flow in rapid succession. If login fails, wait for user intervention rather than hammering the login endpoint.
- **Visible mode**: The `--visible` flag launches the browser in headed mode so the user can interact with it directly. This is the recommended fallback for any authentication challenge that cannot be automated.
