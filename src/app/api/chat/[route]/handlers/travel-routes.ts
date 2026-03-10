import { NextResponse } from 'next/server';
import { getTravelData, getAvailableCountries } from '@/utils/travel-data';
import { pickN, getCountryNameFromCode } from '@/utils/chat-utils';
import { txtResponse, ChatContext } from './shared';

const TRAVEL_ROUTES = new Set([
  'food', 'phrase', 'emergency', 'flirt', 'insults', 'insult',
  'countries', 'fact', 'facts', 'currency', 'convert',
]);

export async function handleTravelRoutes(route: string, q: string, ctx: ChatContext): Promise<NextResponse | null> {
  if (!TRAVEL_ROUTES.has(route)) return null;

  const { persistentLocation } = ctx;

  // Travel routes (food, phrase, emergency, flirt, insults/insult)
  if (route === 'food' || route === 'phrase' || route === 'emergency' || route === 'flirt' || route === 'insults' || route === 'insult') {
    const queryCountryCode = q ? q.trim().toUpperCase() : null;
    const requestedCountryCode = queryCountryCode && queryCountryCode.length === 2 ? queryCountryCode : null;

    if (requestedCountryCode) {
      const availableCountries = getAvailableCountries();
      const isValidCode = availableCountries.some(c => c.code === requestedCountryCode);
      if (!isValidCode) {
        return txtResponse(`Invalid country code: ${requestedCountryCode}. Use !countries to see available countries.`);
      }
    }

    const countryCode = requestedCountryCode || persistentLocation?.location?.countryCode || null;
    const countryName = requestedCountryCode
      ? getCountryNameFromCode(requestedCountryCode)
      : (persistentLocation?.location?.country || (countryCode ? getCountryNameFromCode(countryCode) : null));
    const travelData = getTravelData(countryCode);

    const getNoDataMsg = (type: 'food' | 'phrase' | 'emergency' | 'flirt' | 'insults') => {
      if (countryName && !travelData.isCountrySpecific) {
        const typeNames: Record<string, string> = {
          food: 'local food',
          phrase: 'local phrase',
          emergency: 'emergency information',
          flirt: 'flirting phrases',
          insults: 'local insults'
        };
        return `No ${typeNames[type]} data available for ${countryName} yet. Use !countries to see available countries.`;
      }
      const typeNames: Record<string, string> = {
        food: 'food',
        phrase: 'phrase',
        emergency: 'emergency information',
        flirt: 'flirting phrases',
        insults: 'local insults'
      };
      return `No ${typeNames[type]} data available. Specify a country code (e.g., !${route} JP) or use !countries to see available countries.`;
    };

    if (route === 'food') {
      const foods = pickN(travelData.foods, 3);
      if (foods.length === 0) {
        return txtResponse(getNoDataMsg('food'));
      }
      const note = !travelData.isCountrySpecific && countryName
        ? ` (Global - no ${countryName} data yet)`
        : '';
      const countryPrefix = requestedCountryCode && travelData.isCountrySpecific
        ? `[${countryName}] `
        : '';
      return txtResponse(countryPrefix + foods.join(' · ') + note);
    }

    if (route === 'phrase') {
      const phrases = pickN(travelData.phrases, 3);
      if (phrases.length === 0) {
        return txtResponse(getNoDataMsg('phrase'));
      }

      const lang = phrases[0].lang;
      const formatted = phrases.map((phrase, index) => {
        const phrasePart = phrase.roman
          ? `"${phrase.text}" (${phrase.roman}) = ${phrase.meaning}`
          : `"${phrase.text}" = ${phrase.meaning}`;
        return index === 0 ? `${lang} → ${phrasePart}` : phrasePart;
      });

      const note = !travelData.isCountrySpecific && countryName
        ? ` (Global - no ${countryName} phrases yet)`
        : '';
      const countryPrefix = requestedCountryCode && travelData.isCountrySpecific
        ? `[${countryName}] `
        : '';

      return txtResponse(countryPrefix + formatted.join(' · ') + note);
    }

    if (route === 'emergency') {
      const emergencyInfo = travelData.emergencyInfo;

      if (!emergencyInfo) {
        return txtResponse(getNoDataMsg('emergency'));
      }

      const parts: string[] = [];

      if (travelData.isCountrySpecific && countryName) {
        parts.push(`[${countryName}]`);
      }

      const phoneParts: string[] = [];
      const hasIndividual = emergencyInfo.police || emergencyInfo.ambulance || emergencyInfo.fire;
      if (hasIndividual) {
        if (emergencyInfo.police) phoneParts.push(`Police: ${emergencyInfo.police}`);
        if (emergencyInfo.ambulance) phoneParts.push(`Ambulance: ${emergencyInfo.ambulance}`);
        if (emergencyInfo.fire && emergencyInfo.fire !== emergencyInfo.ambulance) {
          phoneParts.push(`Fire: ${emergencyInfo.fire}`);
        }
      } else if (emergencyInfo.phone) {
        phoneParts.push(emergencyInfo.phone);
      }
      if (phoneParts.length > 0) {
        parts.push(phoneParts.join(' | '));
      }

      if (emergencyInfo.australianEmbassy && countryCode !== 'AU') {
        parts.push(`AU Embassy: ${emergencyInfo.australianEmbassy}`);
      }

      if (parts.length === 0) {
        return txtResponse(getNoDataMsg('emergency'));
      }

      const response = parts.join(' | ');
      return txtResponse(response || getNoDataMsg('emergency'));
    }

    if (route === 'flirt') {
      const flirtPhrases = travelData.flirt || [];
      if (flirtPhrases.length === 0) {
        return txtResponse(getNoDataMsg('flirt'));
      }
      const selectedPhrases = pickN(flirtPhrases, 3);
      const countryPrefix = travelData.isCountrySpecific && countryName
        ? `[${countryName}] `
        : '';
      return txtResponse(countryPrefix + selectedPhrases.join(' · '));
    }

    if (route === 'insults' || route === 'insult') {
      const insults = travelData.insults || [];
      if (insults.length === 0) {
        return txtResponse(getNoDataMsg('insults'));
      }
      const selectedInsults = pickN(insults, 3);
      const countryPrefix = travelData.isCountrySpecific && countryName
        ? `[${countryName}] `
        : '';
      return txtResponse(countryPrefix + selectedInsults.join(' · '));
    }
  }

  if (route === 'countries') {
    const countries = getAvailableCountries();
    const formatted = countries.map(c => `${c.code} (${c.name})`).join(', ');
    return txtResponse(`Available countries: ${formatted}`);
  }

  if (route === 'fact' || route === 'facts') {
    const queryCountryCode = q ? q.trim().toUpperCase() : null;
    const requestedCountryCode = queryCountryCode && queryCountryCode.length === 2 ? queryCountryCode : null;

    if (requestedCountryCode) {
      const availableCountries = getAvailableCountries();
      const isValidCode = availableCountries.some(c => c.code === requestedCountryCode);
      if (!isValidCode) {
        return txtResponse(`Invalid country code: ${requestedCountryCode}. Use !countries to see available countries.`);
      }
    }

    let countryCode: string | null = requestedCountryCode || persistentLocation?.location?.countryCode || null;
    let countryName: string | null = null;

    if (!countryCode) {
      const availableCountries = getAvailableCountries();
      const countriesWithFacts = availableCountries.filter(c => {
        const data = getTravelData(c.code);
        return data.facts && data.facts.length > 0;
      });

      if (countriesWithFacts.length > 0) {
        const randomCountry = pickN(countriesWithFacts, 1)[0];
        countryCode = randomCountry.code;
        countryName = randomCountry.name;
      } else {
        return txtResponse('No facts available. Use !countries to see available countries.');
      }
    } else {
      countryName = requestedCountryCode
        ? getCountryNameFromCode(requestedCountryCode)
        : (persistentLocation?.location?.country || (countryCode ? getCountryNameFromCode(countryCode) : null));
    }

    const travelData = getTravelData(countryCode);
    const facts = travelData.facts || [];

    if (facts.length === 0) {
      const noFactMsg = countryName
        ? `No facts available for ${countryName} yet. Use !countries to see available countries.`
        : 'No facts available. Specify a country code (e.g., !fact JP) or use !countries to see available countries.';
      return txtResponse(noFactMsg);
    }

    const selectedFact = pickN(facts, 1)[0];
    const countryPrefix = travelData.isCountrySpecific && countryName
      ? `[${countryName}] `
      : '';
    return txtResponse(`${countryPrefix}${selectedFact}`);
  }

  if (route === 'currency') {
    const queryCountryCode = q ? q.trim().toUpperCase() : null;
    const requestedCountryCode = queryCountryCode && queryCountryCode.length === 2 ? queryCountryCode : null;

    if (requestedCountryCode) {
      const availableCountries = getAvailableCountries();
      const isValidCode = availableCountries.some(c => c.code === requestedCountryCode);
      if (!isValidCode) {
        return txtResponse(`Invalid country code: ${requestedCountryCode}. Use !countries to see available countries.`);
      }
    }

    const countryCode = requestedCountryCode || persistentLocation?.location?.countryCode || null;
    const countryName = requestedCountryCode
      ? getCountryNameFromCode(requestedCountryCode)
      : (persistentLocation?.location?.country || (countryCode ? getCountryNameFromCode(countryCode) : null));
    const travelData = getTravelData(countryCode);

    if (!travelData.currency) {
      const noCurrencyMsg = countryName
        ? `No currency data available for ${countryName} yet.`
        : 'No currency data available. Specify a country code (e.g., !currency JP)';
      return txtResponse(noCurrencyMsg);
    }

    const { name, symbol, code } = travelData.currency;
    const countryPrefix = requestedCountryCode && travelData.isCountrySpecific
      ? `[${countryName}] `
      : '';
    return txtResponse(`${countryPrefix}${name} (${code}) ${symbol}`);
  }

  if (route === 'convert') {
    const usesDecimals = (currencyCode: string): boolean => {
      const zeroDecimalCurrencies = [
        'JPY', 'KRW', 'VND', 'CLP', 'IDR', 'IQD', 'IRR', 'ISK', 'KMF', 'KPW', 'LAK', 'LBP',
      ];
      return !zeroDecimalCurrencies.includes(currencyCode);
    };

    const parts = q.trim().split(/\s+/).filter(p => p);

    if (parts.length === 0) {
      return txtResponse('Usage: !convert <amount> [FROM] [TO] (e.g., !convert 1000, !convert 1,000.50 AUD, !convert 1000 AUD JPY)');
    }

    const amountStr = parts[0].replace(/,/g, '');
    const amount = parseFloat(amountStr);
    if (isNaN(amount) || amount <= 0) {
      return txtResponse('Usage: !convert <amount> [FROM] [TO] (e.g., !convert 1000, !convert 1,000.50 AUD, !convert 1000 AUD JPY)');
    }

    const currencyCodes = parts.slice(1).map(p => p.toUpperCase());
    let fromCurrency: string | null = null;
    let toCurrency: string = 'USD';

    if (currencyCodes.length === 0) {
      const countryCode = persistentLocation?.location?.countryCode || null;
      const travelData = getTravelData(countryCode);
      if (!travelData.currency) {
        const countryName = persistentLocation?.location?.country || (countryCode ? getCountryNameFromCode(countryCode) : null);
        const noCurrencyMsg = countryName
          ? `No currency data available for ${countryName} yet. Specify currencies: !convert ${amount} <FROM> [TO]`
          : 'No currency data available. Usage: !convert <amount> <FROM> [TO] (e.g., !convert 1000 AUD)';
        return txtResponse(noCurrencyMsg);
      }
      fromCurrency = travelData.currency.code;
      if (fromCurrency === 'USD') {
        toCurrency = 'AUD';
      }
    } else if (currencyCodes.length === 1) {
      fromCurrency = currencyCodes[0];
      if (fromCurrency === 'USD') {
        toCurrency = 'AUD';
      } else {
        toCurrency = 'USD';
      }
    } else if (currencyCodes.length >= 2) {
      fromCurrency = currencyCodes[0];
      toCurrency = currencyCodes[currencyCodes.length - 1];
    }

    if (!fromCurrency) {
      return txtResponse('Usage: !convert <amount> [FROM] [TO] (e.g., !convert 1000, !convert 1,000.50 AUD, !convert 1000 AUD JPY)');
    }
    if (fromCurrency.length !== 3 || !/^[A-Z]{3}$/.test(fromCurrency)) {
      return txtResponse(`Invalid currency code: ${fromCurrency}. Use 3-letter ISO codes (e.g., USD, EUR, JPY, AUD)`);
    }
    if (toCurrency.length !== 3 || !/^[A-Z]{3}$/.test(toCurrency)) {
      return txtResponse(`Invalid currency code: ${toCurrency}. Use 3-letter ISO codes (e.g., USD, EUR, JPY, AUD)`);
    }

    if (fromCurrency === toCurrency) {
      let symbol = '$';
      const allCountries = getAvailableCountries();
      for (const country of allCountries) {
        const data = getTravelData(country.code);
        if (data.currency?.code === fromCurrency) {
          symbol = data.currency.symbol;
          break;
        }
      }
      const formatted = usesDecimals(fromCurrency)
        ? amount.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
        : Math.round(amount).toLocaleString('en-US');
      return txtResponse(`${symbol}${formatted} ${fromCurrency}`);
    }

    const fetchExchangeRate = async (from: string, to: string): Promise<number> => {
      const exchangeRateApiKey = process.env.EXCHANGERATE_API_KEY;
      let rate: number | null = null;
      let lastError: Error | null = null;

      if (exchangeRateApiKey) {
        try {
          const exchangeRateUrl = `https://v6.exchangerate-api.com/v6/${exchangeRateApiKey}/latest/${from}`;
          const exchangeRateResponse = await fetch(exchangeRateUrl, {
            next: { revalidate: 3600 }
          });

          if (exchangeRateResponse.ok) {
            const exchangeRateData = await exchangeRateResponse.json();
            if (exchangeRateData.result === 'success' && exchangeRateData.conversion_rates?.[to]) {
              rate = exchangeRateData.conversion_rates[to];
            } else {
              throw new Error('ExchangeRate-API returned invalid data');
            }
          } else {
            throw new Error(`ExchangeRate-API returned ${exchangeRateResponse.status}`);
          }
        } catch (exchangeRateError) {
          lastError = exchangeRateError instanceof Error ? exchangeRateError : new Error('ExchangeRate-API failed');
        }
      }

      if (!rate) {
        try {
          const frankfurterUrl = `https://api.frankfurter.dev/latest?from=${from}&to=${to}`;
          const frankfurterResponse = await fetch(frankfurterUrl, {
            next: { revalidate: 3600 }
          });

          if (frankfurterResponse.ok) {
            const frankfurterData = await frankfurterResponse.json();
            rate = frankfurterData.rates?.[to];

            if (!rate || typeof rate !== 'number') {
              throw new Error('Invalid rate data from Frankfurter');
            }
          } else {
            throw new Error(`Frankfurter API returned ${frankfurterResponse.status}`);
          }
        } catch (frankfurterError) {
          lastError = frankfurterError instanceof Error ? frankfurterError : new Error('Frankfurter API failed');
        }
      }

      if (!rate) {
        try {
          const exchangeUrl = `https://api.exchangerate.host/latest?base=${from}&symbols=${to}`;
          const exchangeResponse = await fetch(exchangeUrl, {
            next: { revalidate: 3600 }
          });

          if (!exchangeResponse.ok) {
            throw new Error(`exchangerate.host returned ${exchangeResponse.status}`);
          }

          const exchangeData = await exchangeResponse.json();
          rate = exchangeData.rates?.[to];

          if (!rate || typeof rate !== 'number') {
            throw new Error('Invalid exchange rate data from exchangerate.host');
          }
        } catch (exchangeError) {
          lastError = exchangeError instanceof Error ? exchangeError : new Error('exchangerate.host failed');
        }
      }

      if (!rate) {
        throw lastError || new Error('All exchange rate APIs failed');
      }

      return rate;
    };

    try {
      const getCurrencySymbol = (currency: string): string => {
        const allCountries = getAvailableCountries();
        for (const country of allCountries) {
          const data = getTravelData(country.code);
          if (data.currency?.code === currency) {
            return data.currency.symbol;
          }
        }
        return currency;
      };

      const formatAmountForCurrency = (amt: number, currency: string): string => {
        const usesDec = usesDecimals(currency);
        return usesDec
          ? amt.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
          : Math.round(amt).toLocaleString('en-US');
      };

      const targetCurrencies: string[] = currencyCodes.length >= 2
        ? currencyCodes.slice(1)
        : [toCurrency];

      const conversions: string[] = [];
      const fromUsesDecimals = usesDecimals(fromCurrency);
      const formattedAmount = fromUsesDecimals
        ? amount.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
        : Math.round(amount).toLocaleString('en-US');
      const fromSymbol = getCurrencySymbol(fromCurrency);

      for (const targetCurrency of targetCurrencies) {
        if (targetCurrency === fromCurrency) continue;

        const rate = await fetchExchangeRate(fromCurrency, targetCurrency);
        const convertedAmount = amount * rate;

        const toSymbol = getCurrencySymbol(targetCurrency);
        const formattedConverted = formatAmountForCurrency(convertedAmount, targetCurrency);

        conversions.push(`${fromSymbol}${formattedAmount} ${fromCurrency} = ${toSymbol}${formattedConverted} ${targetCurrency}`);
      }

      return txtResponse(conversions.join(' | '));
    } catch (error) {
      console.error('Currency conversion error:', error);
      return txtResponse(`Unable to fetch exchange rate for ${fromCurrency} to ${toCurrency}. Please try again later.`);
    }
  }

  return null;
}
