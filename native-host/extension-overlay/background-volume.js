// Per-process Five9 volume handler. Routes triggerFive9SetPlaybackVolume
// messages through the com.srk.five9volume native messaging host so we
// touch only Five9's audio session — not the headset's master volume.
//
// Installed by apply-overlay.ps1 (overwrites the public stub at the same
// path). The matching native host must also be installed via
// native-host/install.ps1 and the manifest must include the
// "nativeMessaging" permission (apply-overlay.ps1 adds that too).

chrome.runtime.onMessage.addListener((msg) => {
    if (!msg || msg.type !== 'triggerFive9SetPlaybackVolume') return;
    console.log(`SRK [volume] received percent=${msg.percent}`);
    try {
        chrome.runtime.sendNativeMessage(
            'com.srk.five9volume',
            msg.percent === 0
                ? { action: 'setMute',   muted:   true }
                : { action: 'setVolume', percent: msg.percent },
            (response) => {
                const err = chrome.runtime.lastError;
                if (err) {
                    console.warn(`SRK [volume] native host unavailable: ${err.message}`);
                } else {
                    console.log('SRK [volume] native host response:', response);
                }
            }
        );
    } catch (e) {
        console.warn('SRK [volume] sendNativeMessage threw:', e?.message);
    }
});
