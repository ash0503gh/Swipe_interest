// Hard monthly spending cap. The ₹900 budget on the billing account posts to the billing-cap
// Pub/Sub topic several times a day; once spending reaches the budget, this unlinks billing from
// every project on the account, which stops all paid services. Re-link billing in the console to
// bring things back. Projects need roles/billing.projectManager granted to this function's
// service account, or they are skipped (logged).
import functions from '@google-cloud/functions-framework';
import { CloudBillingClient } from '@google-cloud/billing';

const billing = new CloudBillingClient();

functions.cloudEvent('stopBilling', async (event) => {
  const msg = JSON.parse(Buffer.from(event.data.message.data, 'base64').toString());
  const { costAmount, budgetAmount, currencyCode } = msg;
  if (!(costAmount >= budgetAmount)) {
    console.log(`Under budget: ${costAmount} of ${budgetAmount} ${currencyCode}`);
    return;
  }
  console.log(`Budget reached: ${costAmount} of ${budgetAmount} ${currencyCode}; disabling billing`);
  const account = `billingAccounts/${process.env.BILLING_ACCOUNT}`;
  for await (const p of billing.listProjectBillingInfoAsync({ name: account })) {
    if (!p.billingEnabled) continue;
    try {
      await billing.updateProjectBillingInfo({ name: p.name, projectBillingInfo: { billingAccountName: '' } });
      console.log(`Billing disabled: ${p.projectId}`);
    } catch (err) {
      console.error(`Could not disable billing for ${p.projectId}: ${err.message}`);
    }
  }
});
