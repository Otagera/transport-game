// The style spec: every value that decides how the scene looks, in one
// mutable object. Nothing about scene appearance should live as a scattered
// constant elsewhere in render/.
export interface StyleSpec {
  background: {
    color: string;
  };
  base: {
    color: string;
    size: number;
    thickness: number;
  };
  lighting: {
    key: {
      color: string;
      intensity: number;
      azimuthDeg: number;
      elevationDeg: number;
    };
    fill: {
      color: string;
      intensity: number;
    };
    ambient: {
      color: string;
      intensity: number;
    };
  };
  camera: {
    elevationDeg: number;
    azimuthDeg: number;
    viewSize: number;
  };
  placeholder: {
    color: string;
    count: number;
  };
}

export function createDefaultStyleSpec(): StyleSpec {
  return {
    background: {
      color: "#1a1a1a",
    },
    base: {
      color: "#3a3a3a",
      size: 20,
      thickness: 0.6,
    },
    lighting: {
      key: {
        color: "#fff4e0",
        intensity: 3,
        azimuthDeg: 45,
        elevationDeg: 55,
      },
      fill: {
        color: "#8fb2ff",
        intensity: 0.6,
      },
      ambient: {
        color: "#ffffff",
        intensity: 0.35,
      },
    },
    camera: {
      elevationDeg: 35,
      azimuthDeg: 40,
      viewSize: 14,
    },
    placeholder: {
      color: "#9a8f7a",
      count: 5,
    },
  };
}
