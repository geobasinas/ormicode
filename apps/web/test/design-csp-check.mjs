import assert from 'node:assert/strict';
import { BRIDGE_SRC_DOC } from '../../../packages/client-ui/src/features/design/bridge.ts';

export async function checkDesignCsp(page) {
  await page.evaluate(srcdoc => {
    window.designCspMessages = [];
    const frame = document.createElement('iframe');
    frame.id = 'design-csp-test';
    frame.sandbox = 'allow-scripts';
    window.addEventListener('message', event => {
      if (event.source === frame.contentWindow) window.designCspMessages.push(event.data);
    });
    frame.onload = () => frame.contentWindow.postMessage({
      type: 'init', channel: 'design-csp-test-channel', stamp: 1, playback: true, enabled: true,
      html: '<button data-ormi-prototype="frame:next">Next frame</button>', styles: '', tokenStyles: '',
    }, '*');
    frame.srcdoc = srcdoc;
    document.body.append(frame);
  }, BRIDGE_SRC_DOC);
  const button = page.frameLocator('#design-csp-test').getByRole('button', { name: 'Next frame' });
  await button.waitFor();
  await button.click();
  await page.waitForFunction(() => window.designCspMessages.some(message => message.type === 'prototypeAction' && message.action === 'frame:next'));
  await page.evaluate(() => new Promise(resolve => {
    const frame = document.createElement('iframe');
    frame.id = 'untrusted-csp-test';
    frame.onload = () => resolve();
    frame.srcdoc = '<body>Untrusted<script>document.body.dataset.executed="true"</script></body>';
    document.body.append(frame);
  }));
  assert.equal(await page.frameLocator('#untrusted-csp-test').locator('body').getAttribute('data-executed'), null);
  await page.locator('#design-csp-test, #untrusted-csp-test').evaluateAll(frames => frames.forEach(frame => frame.remove()));
}
