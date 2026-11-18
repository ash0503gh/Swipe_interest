// CLI: npm run catalog — builds the Netflix India catalogue into the store.
import { refreshCatalog } from './catalog.js';

refreshCatalog().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
