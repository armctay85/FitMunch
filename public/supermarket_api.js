
// SupermarketAPI for FitMunch
const supermarketAPI = {
  // Get price for a product across supermarkets
  getProductPrice: async function(product) {
    console.log(`Getting price for ${product}`);
    // Simulate API call with mock data
    return new Promise((resolve) => {
      setTimeout(() => {
        // Generate a random price between $2 and $15
        const price = (Math.random() * 13 + 2).toFixed(2);
        
        // Random selection of supermarkets
        const stores = ['Woolworths', 'Coles', 'Aldi', 'IGA'];
        const randomStore = stores[Math.floor(Math.random() * stores.length)];
        
        resolve({
          product: product,
          price: price,
          store: randomStore,
          unit: Math.random() > 0.5 ? 'kg' : 'each'
        });
      }, 500);
    });
  },
  
  // Compare prices across supermarkets
  comparePrices: async function(product) {
    console.log(`Comparing prices for ${product}`);
    // Simulate API call with mock data
    return new Promise((resolve) => {
      setTimeout(() => {
        // Generate random prices for different supermarkets
        const woolworthsPrice = (Math.random() * 10 + 2).toFixed(2);
        const colesPrice = (Math.random() * 10 + 2).toFixed(2);
        
        // Determine which store is cheaper
        const cheapest = parseFloat(woolworthsPrice) <= parseFloat(colesPrice) ? 'Woolworths' : 'Coles';
        
        resolve({
          product: product,
          woolworths: {
            price: woolworthsPrice,
            unit: 'each'
          },
          coles: {
            price: colesPrice,
            unit: 'each'
          },
          cheapest: cheapest,
          savings: Math.abs(parseFloat(woolworthsPrice) - parseFloat(colesPrice)).toFixed(2)
        });
      }, 800);
    });
  },
  
  // Compare product prices - enhanced version for consistent API
  compareProductPrices: async function(product) {
    console.log(`Comparing prices for ${product}`);
    return this.comparePrices(product);
  },
  
  // Get priced shopping list - adds price info to each item
  getPricedShoppingList: async function(items) {
    console.log("Getting priced shopping list");
    if (!Array.isArray(items)) return [];
    
    const pricedItems = await Promise.all(items.map(async (item) => {
      try {
        const priceInfo = await this.comparePrices(item.name);
        
        return {
          ...item,
          priceInfo: priceInfo,
          bestPrice: `$${priceInfo.cheapest === 'Woolworths' ? 
            priceInfo.woolworths.price : priceInfo.coles.price}`,
          bestStore: priceInfo.cheapest,
          savings: priceInfo.savings
        };
      } catch (error) {
        console.error(`Error getting price for ${item.name}:`, error);
        return item;
      }
    }));
    
    return pricedItems;
  },
  
  // Get nearby stores with product availability
  findNearbyStores: async function(product, postcode) {
    console.log(`Finding stores with ${product} near ${postcode}`);
    // Simulate API call with mock data
    return new Promise((resolve) => {
      setTimeout(() => {
        resolve({
          stores: [
            {
              name: 'Woolworths',
              address: '123 Main St',
              distance: '1.2km',
              inStock: true,
              price: '$' + (Math.random() * 10 + 2).toFixed(2)
            },
            {
              name: 'Coles',
              address: '456 High St',
              distance: '2.5km',
              inStock: true,
              price: '$' + (Math.random() * 10 + 2).toFixed(2)
            },
            {
              name: 'Aldi',
              address: '789 Market St',
              distance: '3.7km',
              inStock: Math.random() > 0.5,
              price: Math.random() > 0.5 ? '$' + (Math.random() * 8 + 1).toFixed(2) : 'N/A'
            }
          ]
        });
      }, 1000);
    });
  },
  
  // Get weekly specials for a product
  getWeeklySpecials: async function(product) {
    console.log(`Getting specials for ${product}`);
    // Simulate API call with mock data
    return new Promise((resolve) => {
      setTimeout(() => {
        // 50% chance of having a special
        const hasSpecial = Math.random() > 0.5;
        
        if (hasSpecial) {
          const originalPrice = (Math.random() * 15 + 5).toFixed(2);
          const discountPercent = Math.floor(Math.random() * 40 + 10); // 10-50% off
          const specialPrice = (originalPrice * (1 - discountPercent/100)).toFixed(2);
          
          resolve({
            product: product,
            hasSpecial: true,
            store: Math.random() > 0.5 ? 'Woolworths' : 'Coles',
            originalPrice: originalPrice,
            specialPrice: specialPrice,
            discountPercent: discountPercent,
            validUntil: '2023-06-30' // Mock date
          });
        } else {
          resolve({
            product: product,
            hasSpecial: false
          });
        }
      }, 600);
    });
  }
};

// Make available globally
window.supermarketAPI = supermarketAPI;
