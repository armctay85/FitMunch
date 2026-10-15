// Mock global objects needed for testing
global.Chart = class {
  constructor() {}
  destroy() {}
};

// Mock fetch API
global.fetch = jest.fn(() =>
  Promise.resolve({
    ok: true,
    json: () => Promise.resolve({})
  })
);

// Set up window globals only once to avoid redeclaration
if (!global.window) {
  global.window = {
    dailyLog: {
      meals: {
        breakfast: [],
        lunch: [],
        dinner: [],
        snacks: []
      },
      totalCalories: 0,
      totalSteps: 0
    },
    mealPlans: {
      "Weight Loss": {
        breakfast: ["Egg white omelet", "Protein smoothie"],
        lunch: ["Grilled chicken salad", "Quinoa bowl"],
        dinner: ["Baked salmon", "Steamed vegetables"],
        snacks: ["Greek yogurt", "Almonds"]
      },
      "Maintenance": {
        breakfast: ["Oatmeal with fruits", "Whole grain toast with avocado"],
        lunch: ["Turkey sandwich on whole grain", "Mixed salad with olive oil"],
        dinner: ["Brown rice with lean beef", "Roasted vegetables with chicken"],
        snacks: ["Protein bar", "Fruit with nuts"]
      },
      "Muscle Gain": {
        breakfast: ["Protein smoothie with banana and peanut butter", "Oatmeal with eggs"],
        lunch: ["Chicken pasta with whole grain noodles", "Large salad with tuna"],
        dinner: ["Salmon with brown rice", "Sweet potato with steak"],
        snacks: ["Protein shake", "Trail mix", "Greek yogurt with honey"]
      }
    },
    location: {
      href: ""
    },
    addEventListener: jest.fn(),
    navigator: {
      mediaDevices: {
        getUserMedia: jest.fn().mockResolvedValue({})
      }
    },
    calculateMacros: jest.fn().mockImplementation((calories, goal) => {
      return {
        protein: Math.round((calories * 0.3) / 4),
        carbs: Math.round((calories * 0.4) / 4),
        fat: Math.round((calories * 0.3) / 9)
      };
    })
  };
}

// Define global document if not already defined
if (!global.document) {
  global.document = {
    getElementById: jest.fn(),
    querySelector: jest.fn(),
    querySelectorAll: jest.fn(),
    createElement: jest.fn(),
    body: { appendChild: jest.fn() },
    addEventListener: jest.fn()
  };
}

// Define global localStorage if not already defined
if (!global.localStorage) {
  global.localStorage = {
    getItem: jest.fn(),
    setItem: jest.fn(),
    removeItem: jest.fn()
  };
}

// Define console methods if not already defined
if (!global.console) {
  global.console = {
    log: jest.fn(),
    error: jest.fn(),
    warn: jest.fn()
  };
}
process.env.QUICK_CHECKOUT_MIN_MS = process.env.QUICK_CHECKOUT_MIN_MS || '0';

// jsdom suites do not provide TextEncoder. pg's SCRAM helper needs it, and
// those suites install it themselves after this file runs.
const { TextEncoder, TextDecoder } = require('util');
if (typeof global.TextEncoder !== 'function') global.TextEncoder = TextEncoder;
if (typeof global.TextDecoder !== 'function') global.TextDecoder = TextDecoder;

// A failed SCRAM handshake (pool created before DATABASE_URL is set) reports
// the error and drops the client, but leaves the TCP socket referenced. Postgres
// then holds it until authentication_timeout (60s), which is the "Jest did not
// exit" pause. Close the socket once the client has already surfaced the error.
const pg = require('pg');
const origHandleErrorWhileConnecting = pg.Client.prototype._handleErrorWhileConnecting;
pg.Client.prototype._handleErrorWhileConnecting = function (err) {
  const result = origHandleErrorWhileConnecting.apply(this, arguments);
  try {
    const stream = this.connection && this.connection.stream;
    if (stream && typeof stream.destroy === 'function' && !stream.destroyed) stream.destroy();
  } catch (_) { /* the query error is already reported */ }
  return result;
};
