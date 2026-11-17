import { ControllerToUIMessage, SelectedNodeMeta } from '../shared/messages';

function findTopmostVisibleImageFill(node: SceneNode): ImagePaint | null {
  if (!('fills' in node)) {
    return null;
  }
  const fills = node.fills;
  if (fills === figma.mixed || !Array.isArray(fills)) {
    return null;
  }
  for (let i = fills.length - 1; i >= 0; i--) {
    const paint = fills[i];
    if (
      paint &&
      paint.type === 'IMAGE' &&
      paint.visible !== false &&
      paint.imageHash
    ) {
      return paint;
    }
  }
  return null;
}

export async function inspectCurrentSelection(): Promise<ControllerToUIMessage> {
  const selection = figma.currentPage.selection;

  if (selection.length === 0) {
    return {
      type: 'selection-changed',
      status: 'empty',
    };
  }

  const imageNodes: Array<{ node: SceneNode; paint: ImagePaint }> = [];
  for (const node of selection) {
    const paint = findTopmostVisibleImageFill(node);
    if (paint) {
      imageNodes.push({ node, paint });
    }
  }

  if (imageNodes.length === 0) {
    return {
      type: 'selection-changed',
      status: 'missing-fill',
    };
  }

  const first = imageNodes[0];
  if (!first || !first.paint.imageHash) {
    return {
      type: 'selection-changed',
      status: 'missing-fill',
    };
  }

  const image = figma.getImageByHash(first.paint.imageHash);
  if (!image) {
    return {
      type: 'error',
      code: 'IMAGE_NOT_FOUND',
      message: 'Could not read image data from selected layer.',
    };
  }

  try {
    const bytes = await image.getBytesAsync();
    const meta: SelectedNodeMeta = {
      id: first.node.id,
      name: first.node.name,
      width: Math.round(first.node.width),
      height: Math.round(first.node.height),
      x: Math.round(first.node.x),
      y: Math.round(first.node.y),
      totalSelected: selection.length,
    };

    const isMultiple = selection.length > 1;
    return {
      type: 'selection-changed',
      status: isMultiple ? 'multiple' : 'single',
      node: meta,
      bytes,
      notice: isMultiple
        ? `${selection.length} layers selected — processing "${first.node.name}"`
        : undefined,
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Failed to decode image bytes';
    return {
      type: 'error',
      code: 'IMAGE_READ_FAILED',
      message: msg,
    };
  }
}

