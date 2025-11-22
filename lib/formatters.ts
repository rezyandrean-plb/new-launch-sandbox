const currencyFormatter = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  maximumFractionDigits: 2,
});

export const formatCurrency = (value: number) => currencyFormatter.format(value);

export const formatPercent = (value: number) => {
  // Round to avoid floating point precision issues
  // Multiply by 10000, round, then divide by 100 to get 2 decimal places
  const rounded = Math.round(value * 10000) / 100;
  // Format with up to 2 decimal places, removing trailing zeros
  const formatted = rounded.toFixed(2).replace(/\.?0+$/, '');
  return `${formatted}%`;
};

