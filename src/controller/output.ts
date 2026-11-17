const PLACEMENT_GAP = 24;

async function findSourceNode(sourceId: string): Promise<SceneNode | null> {
  try {
    const node = await figma.getNodeByIdAsync(sourceId);
    if (node && 'x' in node && 'width' in node) {
      return node as SceneNode;
    }
  } catch {
    // Fallback to current selection if node lookup fails
  }
  const first = figma.currentPage.selection[0];
  return first ?? null;
}

export async function applyRasterOutput(
  bytes: Uint8Array,
  width: number,
  height: number,
  sourceId: string,
  label: string
): Promise<void> {
  const source = await findSourceNode(sourceId);
  const image = figma.createImage(bytes);
  const rect = figma.createRectangle();

  const targetWidth = source ? source.width : width;
  const targetHeight = source ? source.height : height;

  rect.resize(Math.max(1, targetWidth), Math.max(1, targetHeight));
  rect.name = `Tiny Effects / ${label}`;
  rect.fills = [
    {
      type: 'IMAGE',
      scaleMode: 'FILL',
      imageHash: image.hash,
    },
  ];

  if (source) {
    rect.x = source.x + source.width + PLACEMENT_GAP;
    rect.y = source.y;
    if (source.parent && 'appendChild' in source.parent) {
      source.parent.appendChild(rect);
    } else {
      figma.currentPage.appendChild(rect);
    }
  } else {
    rect.x = figma.viewport.center.x - targetWidth / 2;
    rect.y = figma.viewport.center.y - targetHeight / 2;
    figma.currentPage.appendChild(rect);
  }

  figma.currentPage.selection = [rect];
  figma.viewport.scrollAndZoomIntoView([rect]);
  figma.notify(`Applied ${label}`);
}

export async function applySvgOutput(
  svg: string,
  sourceId: string,
  label: string
): Promise<void> {
  const source = await findSourceNode(sourceId);
  const frame = figma.createNodeFromSvg(svg);
  frame.name = `Tiny Effects / ${label}`;

  if (source) {
    frame.resize(Math.max(1, source.width), Math.max(1, source.height));
    frame.x = source.x + source.width + PLACEMENT_GAP;
    frame.y = source.y;
    if (source.parent && 'appendChild' in source.parent) {
      source.parent.appendChild(frame);
    } else {
      figma.currentPage.appendChild(frame);
    }
  } else {
    frame.x = figma.viewport.center.x - frame.width / 2;
    frame.y = figma.viewport.center.y - frame.height / 2;
    figma.currentPage.appendChild(frame);
  }

  figma.currentPage.selection = [frame];
  figma.viewport.scrollAndZoomIntoView([frame]);
  figma.notify(`Applied ${label}`);
}

