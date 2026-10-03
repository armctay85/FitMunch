// Public shop helpers. FitMunch does not publish supermarket prices or catalogue dates.
const supermarketAPI = {
  getProductPrice: async function(product) {
    return { product: product, store: '', unit: 'each' };
  },

  comparePrices: async function(product) {
    return { product: product };
  },

  compareProductPrices: async function(product) {
    return this.comparePrices(product);
  },

  getPricedShoppingList: async function(items) {
    if (!Array.isArray(items)) return [];
    return items.map((item) => ({ ...item }));
  },

  findNearbyStores: async function() {
    return { stores: [] };
  },

  getWeeklySpecials: async function(product) {
    return { product: product, hasSpecial: false };
  }
};

window.supermarketAPI = supermarketAPI;
