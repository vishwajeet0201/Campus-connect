export type GroundFloorRoom = {
  id: string;
  name: string;
  x: number;
  y: number;
  width: number;
  height: number;
  kind?: "room" | "open" | "washroom" | "connector";
  color?: string;
};

export type GroundFloorNode = {
  id: string;
  x: number;
  y: number;
  kind: "corridor" | "entrance" | "stairs" | "lift" | "room";
  roomId?: string;
};

export type GroundFloorEdge = {
  from: string;
  to: string;
  accessible: boolean;
};

const Y_SCALE = 1510 / 3700;
const room = (id: string, name: string, x: number, y: number, width: number, height: number, kind: GroundFloorRoom["kind"] = "room"): GroundFloorRoom => ({ id, name, x, y: y * Y_SCALE, width, height: height * Y_SCALE, kind });

export const GROUND_FLOOR_ROOMS: GroundFloorRoom[] = [
  room("mechanical-gate", "Mechanical Gate", 80, 70, 650, 110, "connector"),
  room("towards-mech", "Towards Mech Building", 80, 220, 500, 780, "open"),
  room("directors-bungalow", "Director's Bungalow", 80, 1080, 500, 380),
  room("gymkhana", "Gymkhana", 720, 220, 560, 330),
  room("textile-hall", "Textile Hall", 720, 570, 1360, 500),
  room("textile-department", "Textile Department", 1550, 1100, 300, 130),
  room("construction-maintenance", "Construction & Maintenance Activities Cell", 1320, 220, 700, 300),
  room("plumbing-lab", "Plumbing Lab", 1320, 540, 700, 270),
  room("transportation-lab", "Transportation Engineering Lab", 1320, 830, 700, 250),
  room("hydrology-lab", "Hydrology Lab", 1320, 1100, 450, 330),
  room("fluid-mechanics-lab", "Fluid Mechanics Lab", 1780, 1100, 430, 330),
  room("concrete-technology-lab", "Concrete Technology Lab", 1320, 1450, 430, 190),
  room("structural-engineering-lab", "Structural Engineering Lab", 1320, 1660, 700, 300),
  room("drives-controls-lab", "Drives and Controls Lab", 2260, 220, 390, 330),
  room("electrical-machine-lab", "Electrical Machine Lab", 2670, 220, 420, 330),
  room("biomedical-research", "Biomedical Research", 3110, 220, 420, 330),
  room("electrical-dept-computer-lab", "Electrical Dept Computer Lab", 3550, 220, 470, 330),
  room("vlsi-lab", "VLSI Lab", 4040, 220, 360, 330),
  room("al005", "AL005", 4420, 220, 430, 330),
  room("iot-lab", "IOT LAB", 4870, 220, 330, 330),
  room("coe-lab", "COE LAB", 5220, 220, 470, 330),
  room("simens-lab", "VJTI SIMENS AICTE High Voltage Lab", 5450, 620, 590, 390),
  room("control-dynamics-lab", "Control Dynamics Lab", 5070, 1040, 650, 210),
  room("bee-lab", "BEE Lab", 5070, 1280, 420, 300),
  room("vjti-tbi", "VJTI TBI", 5070, 1600, 650, 350),
  room("al003", "AL003", 5070, 1970, 650, 180),
  room("al002", "AL002", 5070, 2170, 650, 180),
  room("cs-it-lab-2", "CS IT Lab 2", 5070, 2370, 650, 330),
  room("cs-it-lab-3", "CS IT Lab 3 (under construction)", 3500, 1420, 650, 480),
  room("language-lab", "Language Lab", 3500, 1930, 650, 210),
  room("al004", "AL004", 3500, 2170, 650, 210),
  room("ccf1", "CCF1", 3500, 930, 650, 430),
  room("canteen", "Canteen", 2700, 900, 420, 600),
  room("canteen-staff", "Canteen (for staff)", 2700, 1510, 420, 220),
  room("auditorium", "Auditorium", 2260, 1540, 500, 570),
  room("vjti-quad", "VJTI Quad", 3000, 600, 1500, 800, "open"),
  room("quad-stage", "Quad Stage", 3430, 1450, 500, 230),
  room("boys-washroom", "Boys Washroom", 2300, 650, 300, 180, "washroom"),
  room("girls-washroom", "Girls Washroom", 4100, 650, 300, 180, "washroom"),
  room("dep-1", "DEP 1", 3100, 2360, 600, 250),
  room("dep-2", "DEP 2", 3750, 2360, 600, 250),
  room("railway-concession", "Railway Concession", 3100, 2630, 300, 180),
  room("study-space", "Study Space", 4330, 1420, 600, 760, "open"),
  room("vjti-hostels", "VJTI Hostels", 5200, 2780, 850, 270, "open"),
  room("football-ground", "Football Ground", 5200, 3080, 850, 500, "open"),
];

export const GROUND_FLOOR_NODES: GroundFloorNode[] = [
  { id: "entrance-mech", x: 650, y: 400 * Y_SCALE, kind: "entrance" },
  { id: "corridor-west", x: 650, y: 1020 * Y_SCALE, kind: "corridor" },
  { id: "corridor-north", x: 2200, y: 590 * Y_SCALE, kind: "corridor" },
  { id: "corridor-east", x: 4800, y: 1050 * Y_SCALE, kind: "corridor" },
  { id: "corridor-south", x: 4500, y: 2300 * Y_SCALE, kind: "corridor" },
  { id: "stairs-west", x: 2130, y: 1900 * Y_SCALE, kind: "stairs" },
  { id: "stairs-east", x: 4950, y: 1500 * Y_SCALE, kind: "stairs" },
  { id: "lift-east", x: 4750, y: 1900 * Y_SCALE, kind: "lift" },
  ...GROUND_FLOOR_ROOMS.map((item) => ({ id: `room-${item.id}`, x: item.x + item.width / 2, y: item.y + item.height / 2, kind: "room" as const, roomId: item.id })),
];

export const GROUND_FLOOR_EDGES: GroundFloorEdge[] = [
  { from: "entrance-mech", to: "corridor-west", accessible: true },
  { from: "corridor-west", to: "corridor-north", accessible: true },
  { from: "corridor-north", to: "corridor-east", accessible: true },
  { from: "corridor-east", to: "corridor-south", accessible: true },
  { from: "corridor-south", to: "corridor-west", accessible: true },
  { from: "corridor-west", to: "room-towards-mech", accessible: true },
  { from: "corridor-west", to: "room-textile-hall", accessible: true },
  { from: "corridor-north", to: "room-construction-maintenance", accessible: true },
  { from: "corridor-north", to: "room-drives-controls-lab", accessible: true },
  { from: "corridor-north", to: "room-vjti-quad", accessible: true },
  { from: "corridor-east", to: "room-ccf1", accessible: true },
  { from: "corridor-east", to: "room-bee-lab", accessible: true },
  { from: "corridor-east", to: "room-simens-lab", accessible: true },
  { from: "corridor-south", to: "room-auditorium", accessible: true },
  { from: "corridor-south", to: "room-dep-1", accessible: true },
  { from: "corridor-south", to: "room-dep-2", accessible: true },
  { from: "corridor-south", to: "room-cs-it-lab-3", accessible: true },
  { from: "stairs-west", to: "corridor-south", accessible: false },
  { from: "stairs-east", to: "corridor-east", accessible: false },
  { from: "lift-east", to: "corridor-east", accessible: true },
];
