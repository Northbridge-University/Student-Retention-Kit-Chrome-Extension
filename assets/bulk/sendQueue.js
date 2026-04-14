<style>
  /********************************************************************
  ************************* Shared Components CSS *********************
  ********************************************************************/
  #btp-components {
    line-height: 1.25;
    color: black;
    font-family: Helvetica, Arial, sans-serif;
  }
  #btp-components h1 {
    margin-top: 0px;
    margin-bottom: 8px;
    font-size: 34px;
  }
  #btp-components p {
    font-size: 14px;
  }
  #btp-components a {
    color: #896ce8;
    cursor: pointer;
    text-decoration: none;
  }
  #btp-components button {
    display: inline-flex;
    -webkit-box-align: center;
    align-items: center;
    -webkit-box-pack: center;
    justify-content: center;
    position: relative;
    box-sizing: border-box;
    -webkit-tap-highlight-color: transparent;
    outline: 0px;
    border: 0px;
    margin: 0px;
    cursor: pointer;
    user-select: none;
    vertical-align: middle;
    appearance: none;
    text-decoration: none;
    font-family: Roboto, Helvetica, Arial, sans-serif;
    font-weight: 500;
    font-size: 14px;
    line-height: 1.75;
    letter-spacing: 0.02857em;
    text-transform: uppercase;
    min-width: 64px;
    padding: 6px 16px;
    border-radius: 4px;
    transition:
      background-color 250ms cubic-bezier(0.4, 0, 0.2, 1) 0ms,
      box-shadow 250ms cubic-bezier(0.4, 0, 0.2, 1) 0ms,
      border-color 250ms cubic-bezier(0.4, 0, 0.2, 1) 0ms,
      color 250ms cubic-bezier(0.4, 0, 0.2, 1) 0ms;
    color: rgb(255, 255, 255);
    background-color: #896ce8;
    box-shadow:
      rgba(0, 0, 0, 0.2) 0px 3px 1px -2px,
      rgba(0, 0, 0, 0.14) 0px 2px 2px 0px,
      rgba(0, 0, 0, 0.12) 0px 1px 5px 0px;
  }
  #btp-components button:hover {
    text-decoration: none;
    background-color: #7b61d1;
    box-shadow:
      rgba(0, 0, 0, 0.2) 0px 2px 4px -1px,
      rgba(0, 0, 0, 0.14) 0px 4px 5px 0px,
      rgba(0, 0, 0, 0.12) 0px 1px 10px 0px;
  }

  /********************************************************************
  ************************* Overlay / Modal ***************************
  ********************************************************************/
  #btp-modal-overlay,
  #btp-autoresponder-overlay {
    display: none;
    background-color: rgba(0, 0, 0, 0.4);
    position: fixed;
    z-index: 10000;
    left: 0;
    top: 0;
    width: 100%;
    height: 100%;
    overflow: auto;
  }
  #btp-modal-overlay > div,
  #btp-autoresponder-overlay > div {
    z-index: 1000000;
    position: absolute;
    text-align: center;
    top: 48px;
    right: 48px;
    width: 375px;
    border-radius: 4px;
    box-shadow:
      0px 5px 5px -3px rgb(0 0 0 / 20%),
      0px 8px 10px 1px rgb(0 0 0 / 14%),
      0px 3px 14px 2px rgb(0 0 0 / 12%);
    outline: 0;
    padding: 16px;
    background: #fff;
  }

  #failed-texts-guide {
    border: 1px solid #f3e7d2;
    background-color: #fffdf4;
    padding: 8px;
    border-radius: 8px;
    margin-left: 48px;
    margin-right: 48px;
  }

  /***** Send progress report ****/
  #send-progress-report {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    justify-content: center;
    margin: 8px 0 16px 0;
  }
  #send-progress-report > .progress-container {
    flex: 1 1 30%; /*grow | shrink | basis */
  }
  #send-progress-report > .progress-container > .progress-number {
    font-size: 48px;
  }
  #send-progress-report > .progress-container > .progress-description {
    opacity: 0.6;
    font-size: 12px;
  }

  /********************************************************************
  ************************* Autoresponder *****************************
  ********************************************************************/
  #btp-autoresponder-banner {
    display: none;
    position: fixed;
    bottom: 0;
    left: 0;
    right: 0;
    width: 100%;
    height: 70px;
    align-items: center;
    justify-content: center;
    z-index: 1000000;
    background: #f3f0fd;
    box-shadow: 0 0px 6px 2px rgba(66, 69, 73, 0.15);
  }

  #btp-autoresponder-banner h3 {
    display: inline-block;
  }

  #btp-autoresponder-banner button {
    display: inline-block;
  }
</style>
<div id="btp-components">
  <div id="btp-modal-overlay">
    <div>
      <h1>Bulk Texter Pro</h1>
      <div id="btp-sending-info">
        <p>Texts are currently being sent.</p>
        <hr />
        <p id="autoresponse-sending" style="display: none">Autoresponder is running...</p>
        <div id="send-progress-report">
          <div class="progress-container" id="texts-pending">
            <div class="progress-number" style="color: #555">0</div>
            <div class="progress-description">pending</div>
          </div>
          <div class="progress-container" id="texts-sent" style="display: none">
            <div class="progress-number" style="color: #61dafb">0</div>
            <div class="progress-description">sent</div>
          </div>
          <div class="progress-container" id="texts-failed" style="display: none">
            <div class="progress-number" style="color: #ef5350">0</div>
            <div class="progress-description">failed</div>
          </div>
          <p id="failed-texts-guide" style="display: none">
            Check out our
            <a
              href="https://www.bulktexterpro.com/docs/troubleshooting-guide/#4--bulk-texter-pro-tries-to-send-texts-but-fails-to-send-some-or-all-of-them"
              target="_blank"
              rel="noreferrer"
              >troubleshooting guide</a
            >
            to learn how to troubleshoot failed texts.
          </p>
        </div>
        <hr />
        <p>
          On the <a href="https://app.bulktexterpro.com/#history" target="_blank" rel="noreferrer">History tab</a>, you can view a
          full report of this text batch and even
          <a href="https://www.bulktexterpro.com/docs/getting-started/resending-messages/" target="_blank" rel="noreferrer"
            >resend</a
          >
          failed or canceled texts.
        </p>
        <p>
          Feel free to minimize this tab or send it to the background! Learn more in our
          <a
            href="https://www.bulktexterpro.com/docs/faq/#will-bulk-texter-pro-run-in-the-background"
            target="_blank"
            rel="noreferrer"
            >our docs</a
          >.
        </p>
        <button id="btp-cancel-button" class="btp-cancel-button">Cancel Sending</button>
      </div>
      <div id="btp-number-ready-error" style="display: none">
        <h2>Error: Phone Number Not Ready</h2>
        <p>
          Your <span class="texting-platform-name">texting platform</span> number is not ready for texting. You'll need to set it
          up before you can use Bulk Texter Pro with it. Learn more
          <a href="https://www.bulktexterpro.com/docs/getting-started/introduction/" target="_blank" rel="noreferrer"
            >in our docs</a
          >.
        </p>
        <p id="btp-number-ready-google-voice" style="display: none">
          If you're signed into <strong>multiple Google accounts</strong>, go ahead and close this dialog, switch to the correct
          Google Voice account in this tab, then click "Send" in Bulk Texter Pro again.
        </p>
        <p>
          Once your number is set up, you can
          <a href="https://www.bulktexterpro.com/docs/getting-started/resending-messages" target="_blank" rel="noreferrer"
            >resend these texts</a
          >
          from the History tab.
        </p>
        <button id="btp-close-not-ready-button">Close</button>
      </div>
      <div id="btp-verify-error" style="display: none">
        <h2>Error: Account Unverified</h2>
        <p id="btp-generic-verify-error">
          You do not have an active subscription to use Bulk Texter Pro with
          <span class="texting-platform-name">this texting platform</span>.
        </p>
        <p id="btp-account-email-verify-error" style="display: none">
          This <span class="texting-platform-name">texting platform</span> account's email address is
          <a id="texting-platform-email">{email}</a>, which does not match your current Bulk Texter Pro subscription.
        </p>
        <p id="btp-google-voice-verify-error" style="display: none">
          If you're signed into <strong>multiple Google accounts</strong>, go ahead and close this dialog, switch to the correct
          Google Voice account in this tab, then click "Send" in Bulk Texter Pro again.
        </p>
        <p>
          See more info about account verification
          <a
            href="https://www.bulktexterpro.com/docs/troubleshooting-guide/#unverified-status-under-messages-not-sent"
            target="_blank"
            rel="noreferrer"
            >in our docs</a
          >.
        </p>
        <p>
          Once you have an active subscription associated with this account, you can
          <a href="https://www.bulktexterpro.com/docs/getting-started/resending-messages" target="_blank" rel="noreferrer"
            >resend these texts</a
          >
          from the History tab.
        </p>
        <button id="btp-close-unverified-button">Close</button>
      </div>
    </div>
  </div>
  <div id="btp-autoresponder-overlay">
    <div>
      <h1>Bulk Texter Pro</h1>
      <h3>Autoresponder is running...</h3>
    </div>
  </div>
  <div id="btp-autoresponder-banner">
    <div style="text-align: right">
      <h3 style="margin: 0px">Bulk Texter Pro Autoresponder is enabled.</h3>
      <div>
        Please keep your computer on and awake. Learn more in
        <a href="https://www.bulktexterpro.com/docs/getting-started/autoresponder/" target="_blank">our docs</a>.
      </div>
    </div>
    <a target="_blank" href="https://app.bulktexterpro.com/#settings">
      <button id="btp-autoresponder-edit-button" style="margin-left: 24px">Edit</button>
    </a>
    <button id="btp-autoresponder-disable-button" style="margin-left: 16px">Disable</button>
  </div>
</div>
