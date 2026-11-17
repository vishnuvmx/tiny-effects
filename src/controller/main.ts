import { ControllerToUIMessage, UIToControllerMessage } from '../shared/messages';
import { inspectCurrentSelection } from './selection';
import { applyRasterOutput, applySvgOutput } from './output';

const PLUGIN_WIDTH = 300;
const PLUGIN_HEIGHT = 560;

let ignoreNextSelectionChange = false;

figma.showUI(__html__, {
  width: PLUGIN_WIDTH,
  height: PLUGIN_HEIGHT,
  themeColors: true,
  title: 'Tiny Effects',
});

function sendToUI(message: ControllerToUIMessage): void {
  figma.ui.postMessage(message);
}

async function broadcastSelection(): Promise<void> {
  const result = await inspectCurrentSelection();
  sendToUI(result);
}

figma.on('selectionchange', () => {
  if (ignoreNextSelectionChange) {
    ignoreNextSelectionChange = false;
    return;
  }
  void broadcastSelection();
});

figma.ui.onmessage = async (msg: UIToControllerMessage) => {
  try {
    switch (msg.type) {
      case 'ui-ready': {
        await broadcastSelection();
        break;
      }
      case 'apply-raster': {
        ignoreNextSelectionChange = true;
        await applyRasterOutput(
          msg.bytes,
          msg.width,
          msg.height,
          msg.sourceId,
          msg.label
        );
        sendToUI({ type: 'apply-complete', label: msg.label });
        break;
      }
      case 'apply-svg': {
        ignoreNextSelectionChange = true;
        await applySvgOutput(msg.svg, msg.sourceId, msg.label);
        sendToUI({ type: 'apply-complete', label: msg.label });
        break;
      }
      case 'notify': {
        figma.notify(msg.message);
        break;
      }
    }
  } catch (err) {
    ignoreNextSelectionChange = false;
    const message = err instanceof Error ? err.message : 'Operation failed';
    sendToUI({
      type: 'error',
      code: 'APPLY_FAILED',
      message,
    });
  }
};
