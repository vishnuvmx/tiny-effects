export type SelectionStatus =
  | 'empty'
  | 'unsupported'
  | 'missing-fill'
  | 'single'
  | 'multiple';

export interface SelectedNodeMeta {
  id: string;
  name: string;
  width: number;
  height: number;
  x: number;
  y: number;
  totalSelected: number;
}

export type ControllerToUIMessage =
  | {
      type: 'selection-changed';
      status: SelectionStatus;
      node?: SelectedNodeMeta;
      bytes?: Uint8Array;
      notice?: string;
    }
  | {
      type: 'apply-complete';
      label: string;
    }
  | {
      type: 'error';
      code: string;
      message: string;
    };

export type UIToControllerMessage =
  | {
      type: 'ui-ready';
    }
  | {
      type: 'apply-raster';
      bytes: Uint8Array;
      width: number;
      height: number;
      sourceId: string;
      label: string;
    }
  | {
      type: 'apply-svg';
      svg: string;
      sourceId: string;
      label: string;
    }
  | {
      type: 'notify';
      message: string;
    };
