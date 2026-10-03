// Supermarket price lookups are not available. Prices vary by store and week.
const supermarketAPI = {
  getProductPrice: async function(product) {
    return { product: product, price: null, store: null, note: 'Prices vary by store and week.' };
  },
  comparePrices: async function(product) {
    return { product: product, note: 'Prices vary by store and week.' };
  },
  compareProductPrices: async function(product) {
    return this.comparePrices(product);
  },
  getPricedShoppingList: async function(items) {
    if (!Array.isArray(items)) return [];
    return items.map((item) => ({ ...item, note: 'Prices vary by store and week.' }));
  },
  findNearbyStores: async function(product) {
    return { product: product, stores: [], note: 'Prices vary by store and week.' };
  },
  getWeeklySpecials: async function(product) {
    return { product: product, note: 'Prices vary by store and week.' };
  }
};

window.supermarketAPI = supermarketAPI;
