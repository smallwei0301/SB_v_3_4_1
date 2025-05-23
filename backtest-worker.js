// Global variable for cache
let workerCachedStockData = {};

// --- Date Helper Functions ---
/**
 * Converts a ROC date string (e.g., "112/01/05") to "YYYY-MM-DD" Gregorian format.
 * @param {string} rocDateStr - ROC date string "YYY/MM/DD"
 * @returns {string} Gregorian date string "YYYY-MM-DD"
 */
function rocToGregorian(rocDateStr) {
    if (!rocDateStr) return null;
    const parts = rocDateStr.split('/');
    if (parts.length !== 3) return null;
    
    const rocYear = parseInt(parts[0], 10);
    const month = parts[1].padStart(2, '0');
    const day = parts[2].padStart(2, '0');
    
    const gregorianYear = rocYear + 1911;
    return `${gregorianYear}-${month}-${day}`;
}

/**
 * Converts Gregorian year, month to ROC date string YYYYMMDD for API.
 * @param {number} year - Gregorian year
 * @param {number} month - Gregorian month (1-12)
 * @returns {string} ROC date string "YYYYMMDD" (e.g., "1100101")
 */
function gregorianToRocStrApi(year, month) {
    const rocYear = year - 1911;
    const monthStr = String(month).padStart(2, '0');
    // The API seems to accept any day of the month and returns the whole month's data.
    // Using "01" for consistency.
    return `${rocYear}${monthStr}01`; 
}

// --- Data Parsing Helper Functions ---
/**
 * Parses a price string (which might have commas or be "--") into a float or null.
 * @param {string} priceStr 
 * @returns {number|null}
 */
function parsePrice(priceStr) {
    if (typeof priceStr !== 'string') return null;
    const cleanedStr = priceStr.replace(/,/g, '');
    if (cleanedStr === "--" || cleanedStr === "" || isNaN(parseFloat(cleanedStr))) {
        return null;
    }
    return parseFloat(cleanedStr);
}

/**
 * Parses a volume string (which might have commas) into an integer or null.
 * @param {string} volumeStr 
 * @returns {number|null}
 */
function parseVolume(volumeStr) {
    if (typeof volumeStr !== 'string') return null;
    const cleanedStr = volumeStr.replace(/,/g, '');
    if (cleanedStr === "--" || cleanedStr === "" || isNaN(parseInt(cleanedStr, 10))) {
        return null;
    }
    return parseInt(cleanedStr, 10);
}


// --- Core Data Fetching Functions ---

/**
 * Fetches stock data for a specific month from TWSE API.
 * @param {string} stockCode - The stock symbol (e.g., "2330").
 * @param {number} year - The Gregorian year.
 * @param {number} month - The month (1-12).
 * @returns {Promise<Array<object>>} Array of transformed data objects for the month.
 */
async function fetchStockDataForMonth(stockCode, year, month) {
    const rocDateStr = gregorianToRocStrApi(year, month);
    const apiUrl = `https://www.twse.com.tw/exchangeReport/STOCK_DAY?response=json&date=${rocDateStr}&stockNo=${stockCode}`;

    console.log(`Fetching: ${apiUrl}`);
    const response = await fetch(apiUrl);
    if (!response.ok) {
        throw new Error(`API request failed for ${stockCode} ${year}-${month} with status ${response.status}`);
    }

    const jsonResponse = await response.json();

    if (jsonResponse.stat !== "OK") {
        // Common issue: "很抱歉，沒有符合條件的資料!" (no data for this month/stock)
        if (jsonResponse.stat.includes("沒有符合條件的資料")) {
            console.warn(`No data found for ${stockCode} for ${year}-${String(month).padStart(2, '0')}. TWSE Message: ${jsonResponse.stat}`);
            return []; // Return empty array if no data, not an error
        }
        throw new Error(`API error for ${stockCode} ${year}-${month}: ${jsonResponse.stat}`);
    }

    if (!jsonResponse.data) {
        console.warn(`No data array found for ${stockCode} for ${year}-${String(month).padStart(2, '0')}, despite OK status.`);
        return [];
    }
    
    return jsonResponse.data.map(item => {
        // item: [ "日期", "成交股數", "成交金額", "開盤價", "最高價", "最低價", "收盤價", "漲跌價差", "成交筆數" ]
        // e.g., ["112/01/03","20,886,761","9,536,996,111","454.00","459.00","453.00","458.50","+4.50","24,275"]
        const date = rocToGregorian(item[0]);
        if (!date) return null; // Skip if date conversion fails

        return {
            date: date,
            open: parsePrice(item[3]),
            high: parsePrice(item[4]),
            low: parsePrice(item[5]),
            close: parsePrice(item[6]),
            volume: parseVolume(item[1])
        };
    }).filter(item => item !== null && item.open !== null && item.close !== null); // Filter out days with invalid date or critical null prices
}

/**
 * Main data fetching logic spanning multiple months with caching.
 * @param {string} stockCode - The stock symbol.
 * @param {string} startDateStr - Start date "YYYY-MM-DD".
 * @param {string} endDateStr - End date "YYYY-MM-DD".
 * @returns {Promise<Array<object>>} Sorted array of stock data.
 */
async function WorkspaceStockData(stockCode, startDateStr, endDateStr) {
    let allStockData = [];
    const startDate = new Date(startDateStr);
    const endDate = new Date(endDateStr);

    // Ensure start date is before end date
    if (startDate > endDate) {
        throw new Error("Start date cannot be after end date.");
    }

    let currentYear = startDate.getFullYear();
    let currentMonth = startDate.getMonth() + 1; // JavaScript months are 0-indexed

    const lastYear = endDate.getFullYear();
    const lastMonth = endDate.getMonth() + 1;

    while (currentYear < lastYear || (currentYear === lastYear && currentMonth <= lastMonth)) {
        const cacheKey = `${stockCode}-${currentYear}-${currentMonth}`;
        
        self.postMessage({ type: 'progress', message: `Checking data for ${stockCode}: ${currentYear}-${String(currentMonth).padStart(2, '0')}` });

        if (workerCachedStockData[cacheKey]) {
            console.log(`Using cached data for ${cacheKey}`);
            allStockData.push(...workerCachedStockData[cacheKey]);
        } else {
            try {
                self.postMessage({ type: 'progress', message: `Fetching data for ${stockCode}: ${currentYear}-${String(currentMonth).padStart(2, '0')}` });
                const monthlyData = await fetchStockDataForMonth(stockCode, currentYear, currentMonth);
                workerCachedStockData[cacheKey] = monthlyData;
                allStockData.push(...monthlyData);
                
                // Polite delay between API calls
                await new Promise(resolve => setTimeout(resolve, 3000 + Math.random() * 2000)); // 3-5 seconds
            } catch (error) {
                console.error(`Error fetching data for ${stockCode} ${currentYear}-${currentMonth}:`, error);
                self.postMessage({ type: 'error', message: `Error fetching data for ${stockCode} ${currentYear}-${String(currentMonth).padStart(2, '0')}: ${error.message}` });
                // Optionally, decide if you want to stop or continue for other months
            }
        }

        // Move to the next month
        currentMonth++;
        if (currentMonth > 12) {
            currentMonth = 1;
            currentYear++;
        }
    }

    // Filter data to be within the exact startDateStr and endDateStr
    allStockData = allStockData.filter(d => {
        const dataDate = new Date(d.date);
        return dataDate >= startDate && dataDate <= endDate;
    });

    // Sort by date
    allStockData.sort((a, b) => new Date(a.date) - new Date(b.date));

    return allStockData;
}

// --- Indicator Calculation Functions ---

/**
 * Calculates Simple Moving Average (MA).
 * @param {Array<object>} data - Array of stock data objects.
 * @param {number} period - The period for the MA.
 * @param {string} dataKey - The key in the data objects to use (defaults to 'close').
 * @returns {Array<number|null>} Array of MA values.
 */
function calculateMA(data, period, dataKey = 'close') {
    if (!data || data.length < period) return new Array(data.length).fill(null);

    const results = new Array(data.length).fill(null);
    for (let i = period - 1; i < data.length; i++) {
        let sum = 0;
        for (let j = 0; j < period; j++) {
            sum += data[i - j][dataKey];
        }
        results[i] = sum / period;
    }
    return results;
}

/**
 * Calculates Exponential Moving Average (EMA).
 * @param {Array<object>} data - Array of stock data objects.
 * @param {number} period - The period for the EMA.
 * @param {string} dataKey - The key for calculation (defaults to 'close').
 * @returns {Array<number|null>} Array of EMA values.
 */
function calculateEMA(data, period, dataKey = 'close') {
    if (!data || data.length < period) return new Array(data.length).fill(null);

    const results = new Array(data.length).fill(null);
    const k = 2 / (period + 1);
    
    // Calculate initial SMA for the first EMA value
    let sum = 0;
    for (let i = 0; i < period; i++) {
        sum += data[i][dataKey];
    }
    results[period - 1] = sum / period;

    // Calculate subsequent EMAs
    for (let i = period; i < data.length; i++) {
        results[i] = (data[i][dataKey] * k) + (results[i - 1] * (1 - k));
    }
    return results;
}

/**
 * Calculates Relative Strength Index (RSI).
 * @param {Array<object>} data - Array of stock data objects.
 * @param {number} period - The period for RSI (typically 14).
 * @param {string} dataKey - The key for calculation (defaults to 'close').
 * @returns {Array<number|null>} Array of RSI values.
 */
function calculateRSI(data, period, dataKey = 'close') {
    if (!data || data.length <= period) return new Array(data.length).fill(null); // Need period+1 points for first RSI

    const results = new Array(data.length).fill(null);
    let gains = 0;
    let losses = 0;

    // Calculate initial average gain and loss for the first 'period' changes
    for (let i = 1; i <= period; i++) {
        const change = data[i][dataKey] - data[i - 1][dataKey];
        if (change > 0) {
            gains += change;
        } else {
            losses += Math.abs(change);
        }
    }

    let avgGain = gains / period;
    let avgLoss = losses / period;

    if (avgLoss === 0) {
        results[period] = 100;
    } else {
        const rs = avgGain / avgLoss;
        results[period] = 100 - (100 / (1 + rs));
    }

    // Calculate subsequent RSIs using smoothed average gain/loss
    for (let i = period + 1; i < data.length; i++) {
        const change = data[i][dataKey] - data[i - 1][dataKey];
        let currentGain = 0;
        let currentLoss = 0;

        if (change > 0) {
            currentGain = change;
        } else {
            currentLoss = Math.abs(change);
        }

        avgGain = ((avgGain * (period - 1)) + currentGain) / period;
        avgLoss = ((avgLoss * (period - 1)) + currentLoss) / period;

        if (avgLoss === 0) {
            results[i] = 100; // Or some other appropriate value like previous RSI if data is flat
        } else {
            const rs = avgGain / avgLoss;
            results[i] = 100 - (100 / (1 + rs));
        }
    }
    return results;
}


/**
 * Calculates and adds required indicators to the historical data.
 * @param {Array<object>} historicalDataWithIndicators - Array of stock data, will be augmented.
 * @param {object} strategiesConfig - Configuration for active strategies.
 */
function calculateAllIndicators(historicalDataWithIndicators, strategiesConfig) {
    if (!historicalDataWithIndicators || historicalDataWithIndicators.length === 0) return;

    const calculatedIndicatorKeys = new Set(); // Tracks 'ma10', 'rsi14', etc.

    const processStrategy = (strategy) => {
        if (!strategy || !strategy.id || !strategy.params) return;

        switch (strategy.id) {
            case 'maCross': {
                const { shortMA, longMA } = strategy.params;
                const shortMAKey = `ma${shortMA}`;
                const longMAKey = `ma${longMA}`;

                if (!calculatedIndicatorKeys.has(shortMAKey)) {
                    const maValues = calculateMA(historicalDataWithIndicators, shortMA);
                    maValues.forEach((val, idx) => {
                        if (historicalDataWithIndicators[idx]) historicalDataWithIndicators[idx][shortMAKey] = val;
                    });
                    calculatedIndicatorKeys.add(shortMAKey);
                }
                if (!calculatedIndicatorKeys.has(longMAKey)) {
                    const maValues = calculateMA(historicalDataWithIndicators, longMA);
                    maValues.forEach((val, idx) => {
                        if (historicalDataWithIndicators[idx]) historicalDataWithIndicators[idx][longMAKey] = val;
                    });
                    calculatedIndicatorKeys.add(longMAKey);
                }
                break;
            }
            case 'rsiBasic': {
                const { rsiPeriod } = strategy.params;
                const rsiKey = `rsi${rsiPeriod}`;

                if (!calculatedIndicatorKeys.has(rsiKey)) {
                    const rsiValues = calculateRSI(historicalDataWithIndicators, rsiPeriod);
                    rsiValues.forEach((val, idx) => {
                        if (historicalDataWithIndicators[idx]) historicalDataWithIndicators[idx][rsiKey] = val;
                    });
                    calculatedIndicatorKeys.add(rsiKey);
                }
                break;
            }
            // Add cases for other strategies like EMA-based ones if needed
            // case 'emaCross': { ... }
        }
    };

    // Process all parts of the strategy configuration
    if (strategiesConfig.longEntry) processStrategy(strategiesConfig.longEntry);
    if (strategiesConfig.longExit) processStrategy(strategiesConfig.longExit);
    if (strategiesConfig.enableShortSelling) {
        if (strategiesConfig.shortEntry) processStrategy(strategiesConfig.shortEntry);
        if (strategiesConfig.shortExit) processStrategy(strategiesConfig.shortExit);
    }
}

// --- Strategy Signal Checking Functions ---
function checkMaCrossSignal(currentDayData, prevDayData, strategyParams, type) {
    if (!currentDayData || !prevDayData || !strategyParams) return false;
    const { shortMA, longMA } = strategyParams;
    const shortMAKey = `ma${shortMA}`;
    const longMAKey = `ma${longMA}`;

    if (currentDayData[shortMAKey] == null || currentDayData[longMAKey] == null || 
        prevDayData[shortMAKey] == null || prevDayData[longMAKey] == null) {
        return false;
    }

    if (type === 'entry') { // Golden Cross for long entry, Death Cross for short entry
        return prevDayData[shortMAKey] <= prevDayData[longMAKey] && 
               currentDayData[shortMAKey] > currentDayData[longMAKey];
    } else if (type === 'exit') { // Death Cross for long exit, Golden Cross for short cover
        return prevDayData[shortMAKey] >= prevDayData[longMAKey] && 
               currentDayData[shortMAKey] < currentDayData[longMAKey];
    }
    return false;
}

function checkRsiSignal(currentDayData, prevDayData, strategyParams, type, positionType) {
    // positionType is 'long' or 'short'
    if (!currentDayData || !strategyParams) return false;
    const { rsiPeriod, rsiOversold, rsiOverbought } = strategyParams;
    const rsiKey = `rsi${rsiPeriod}`;

    if (currentDayData[rsiKey] == null) return false;

    if (type === 'entry') {
        if (positionType === 'long') return currentDayData[rsiKey] < rsiOversold; // Buy when oversold
        if (positionType === 'short') return currentDayData[rsiKey] > rsiOverbought; // Short when overbought
    } else if (type === 'exit') {
        if (positionType === 'long') return currentDayData[rsiKey] > rsiOverbought; // Sell when overbought
        if (positionType === 'short') return currentDayData[rsiKey] < rsiOversold; // Cover when oversold
    }
    return false;
}

// --- Core Backtesting Engine ---

function runStrategy(params, historicalData) {
    let currentCapital = params.initialCapital;
    const equityCurve = [{ date: historicalData[0]?.date || params.startDate, value: params.initialCapital }];
    const trades = [];
    let position = { type: null, entryPrice: 0, shares: 0, entryDate: null, valueAtEntry: 0, entryCapital: 0 };
    
    let buyAndHoldShares = 0;
    if (historicalData.length > 0 && historicalData[0].open) {
         buyAndHoldShares = params.initialCapital / historicalData[0].open;
    }
    let buyAndHoldPortfolioValue = params.initialCapital;

    const strategiesConfig = {
        longEntry: params.longEntryStrategy,
        longExit: params.longExitStrategy,
        enableShortSelling: params.enableShortSelling,
        shortEntry: params.shortEntryStrategy,
        shortExit: params.shortExitStrategy,
    };
    calculateAllIndicators(historicalData, strategiesConfig);

    // Helper: Get trade price based on execution type
    function getTradePrice(dayIndex, executionType, historicalData) {
        if (executionType === 'N_close') {
            return historicalData[dayIndex]?.close;
        } else if (executionType === 'N1_open') {
            return historicalData[dayIndex + 1]?.open;
        }
        return null; // Should not happen
    }
    
    // Helper: Execute Entry
    function executeEntry(type, entryPrice, date, capitalBeforeTrade, currentPosition) {
        if (entryPrice == null || entryPrice <= 0) return { updatedCapital: capitalBeforeTrade, updatedPosition: currentPosition, tradeExecuted: false };

        let capitalToUse = params.positionSizingBasis === 'initialCapital' ? params.initialCapital : capitalBeforeTrade;
        let investmentAmount = capitalToUse * (params.positionSizePercentage / 100);
        
        // Ensure we don't use more capital than available if sizing based on total equity.
        if (params.positionSizingBasis === 'totalEquity' && investmentAmount > capitalBeforeTrade) {
            investmentAmount = capitalBeforeTrade;
        }
        
        let sharesToTrade = Math.floor(investmentAmount / entryPrice);
        if (sharesToTrade === 0) return { updatedCapital: capitalBeforeTrade, updatedPosition: currentPosition, tradeExecuted: false };

        const tradeValue = sharesToTrade * entryPrice;
        const fee = tradeValue * (params.buyFeeRate / 100);
        let newCapital = capitalBeforeTrade;
        
        if (type === 'long') {
            if (newCapital < tradeValue + fee) { // Not enough capital
                sharesToTrade = Math.floor((newCapital - fee) / entryPrice); // Adjust shares
                if (sharesToTrade === 0) return { updatedCapital: capitalBeforeTrade, updatedPosition: currentPosition, tradeExecuted: false };
            }
            newCapital -= (sharesToTrade * entryPrice) + fee;
        } else { // short
            newCapital += (sharesToTrade * entryPrice) - fee; // Credit from short sale, less fees
        }
        
        const newPosition = {
            type: type,
            entryPrice: entryPrice,
            shares: sharesToTrade,
            entryDate: date,
            valueAtEntry: sharesToTrade * entryPrice, // Value of shares at entry
            entryCapitalSnapshot: capitalBeforeTrade // Capital snapshot before this trade
        };
        return { updatedCapital: newCapital, updatedPosition: newPosition, tradeExecuted: true };
    }

    // Helper: Execute Exit
    function executeExit(exitPrice, date, reason, currentPosition, capitalBeforeExit) {
        if (exitPrice == null || exitPrice <= 0 || !currentPosition.type) return { updatedCapital: capitalBeforeExit, updatedPosition: currentPosition, tradeExecuted: false };

        const proceeds = currentPosition.shares * exitPrice;
        const fee = proceeds * (params.sellFeeRate / 100);
        let profit;
        let newCapital = capitalBeforeExit;

        if (currentPosition.type === 'long') {
            newCapital += proceeds - fee;
            profit = (proceeds - fee) - currentPosition.valueAtEntry;
        } else { // short
            const costToCover = proceeds + fee;
            newCapital -= costToCover; // Debit to buy back shares
            // Profit for short: (value when shorted) - (cost to cover)
            // Value when shorted = shares * entryPrice (this is the credit received)
            // Cost to cover = shares * exitPrice + fee
            profit = currentPosition.valueAtEntry - costToCover;
        }
        
        trades.push({
            entryDate: currentPosition.entryDate,
            entryPrice: currentPosition.entryPrice,
            exitDate: date,
            exitPrice: exitPrice,
            shares: currentPosition.shares,
            profit: profit,
            type: currentPosition.type,
            reason: reason,
            capitalAtEntry: currentPosition.entryCapitalSnapshot,
            capitalAtExit: newCapital
        });
        
        const newPosition = { type: null, entryPrice: 0, shares: 0, entryDate: null, valueAtEntry: 0, entryCapital:0 };
        return { updatedCapital: newCapital, updatedPosition: newPosition, tradeExecuted: true };
    }

    // Main Simulation Loop
    for (let i = 1; i < historicalData.length; i++) {
        const currentDayData = historicalData[i];
        const prevDayData = historicalData[i - 1];
        const currentDate = currentDayData.date;
        let signalTradePrice, stopLossTakeProfitTradePrice;

        // Determine trade price for stop-loss/take-profit (occurs during current day)
        // For simplicity, let's assume SL/TP can be executed at the SL/TP price if hit.
        // A more realistic model would use currentDayData.open or currentDayData.low/high.
        // For now, if SL/TP condition met, use the trigger price as execution price.

        // Stop-Loss / Take-Profit Check
        if (position.type) {
            let slTpTriggered = false;
            let slTpExitPrice = 0;
            let slTpReason = "";

            if (position.type === 'long') {
                if (params.fixedStopLossPercentage > 0 && currentDayData.low <= position.entryPrice * (1 - params.fixedStopLossPercentage / 100)) {
                    slTpTriggered = true;
                    slTpExitPrice = Math.min(currentDayData.open, position.entryPrice * (1 - params.fixedStopLossPercentage / 100)); // Gapped down or hit
                    slTpReason = "StopLoss";
                } else if (params.fixedTakeProfitPercentage > 0 && currentDayData.high >= position.entryPrice * (1 + params.fixedTakeProfitPercentage / 100)) {
                    slTpTriggered = true;
                    slTpExitPrice = Math.max(currentDayData.open, position.entryPrice * (1 + params.fixedTakeProfitPercentage / 100)); // Gapped up or hit
                    slTpReason = "TakeProfit";
                }
            } else if (position.type === 'short') {
                if (params.fixedStopLossPercentage > 0 && currentDayData.high >= position.entryPrice * (1 + params.fixedStopLossPercentage / 100)) {
                    slTpTriggered = true;
                    slTpExitPrice = Math.max(currentDayData.open, position.entryPrice * (1 + params.fixedStopLossPercentage / 100));
                    slTpReason = "StopLoss";
                } else if (params.fixedTakeProfitPercentage > 0 && currentDayData.low <= position.entryPrice * (1 - params.fixedTakeProfitPercentage / 100)) {
                    slTpTriggered = true;
                    slTpExitPrice = Math.min(currentDayData.open, position.entryPrice * (1 - params.fixedTakeProfitPercentage / 100));
                    slTpReason = "TakeProfit";
                }
            }

            if (slTpTriggered) {
                const { updatedCapital, updatedPosition } = executeExit(slTpExitPrice, currentDate, slTpReason, position, currentCapital);
                currentCapital = updatedCapital;
                position = updatedPosition;
            }
        }

        // Strategy-Based Exit Check (if still in position)
        if (position.type) {
            let strategyExitSignal = false;
            const exitStrategy = position.type === 'long' ? params.longExitStrategy : params.shortExitStrategy;
            if (exitStrategy && exitStrategy.id) {
                if (exitStrategy.id === 'maCross') {
                    strategyExitSignal = checkMaCrossSignal(currentDayData, prevDayData, exitStrategy.params, 'exit');
                } else if (exitStrategy.id === 'rsiBasic') {
                    strategyExitSignal = checkRsiSignal(currentDayData, prevDayData, exitStrategy.params, 'exit', position.type);
                }
            }

            if (strategyExitSignal) {
                const exitPrice = getTradePrice(i, params.tradeExecution, historicalData);
                if (exitPrice != null) {
                    const { updatedCapital, updatedPosition } = executeExit(exitPrice, 
                        params.tradeExecution === 'N1_open' && historicalData[i+1] ? historicalData[i+1].date : currentDate, 
                        "StrategySignal", position, currentCapital);
                    currentCapital = updatedCapital;
                    position = updatedPosition;
                }
            }
        }

        // Strategy-Based Entry Check (if not in a position)
        if (!position.type) {
            let entrySignal = false;
            let entryType = null; // 'long' or 'short'

            // Check Long Entry
            if (params.longEntryStrategy && params.longEntryStrategy.id) {
                if (params.longEntryStrategy.id === 'maCross') {
                    entrySignal = checkMaCrossSignal(currentDayData, prevDayData, params.longEntryStrategy.params, 'entry');
                    if (entrySignal) entryType = 'long';
                } else if (params.longEntryStrategy.id === 'rsiBasic') {
                    entrySignal = checkRsiSignal(currentDayData, prevDayData, params.longEntryStrategy.params, 'entry', 'long');
                    if (entrySignal) entryType = 'long';
                }
            }

            // Check Short Entry (if no long entry signal and short selling enabled)
            if (!entrySignal && params.enableShortSelling && params.shortEntryStrategy && params.shortEntryStrategy.id) {
                 if (params.shortEntryStrategy.id === 'maCross') { // Death cross for short entry
                    entrySignal = checkMaCrossSignal(currentDayData, prevDayData, params.shortEntryStrategy.params, 'exit'); // 'exit' type for death cross
                    if (entrySignal) entryType = 'short';
                } else if (params.shortEntryStrategy.id === 'rsiBasic') {
                    entrySignal = checkRsiSignal(currentDayData, prevDayData, params.shortEntryStrategy.params, 'entry', 'short');
                    if (entrySignal) entryType = 'short';
                }
            }
            
            if (entrySignal && entryType) {
                const entryPrice = getTradePrice(i, params.tradeExecution, historicalData);
                if (entryPrice != null) {
                     const { updatedCapital, updatedPosition } = executeEntry(entryType, entryPrice, 
                        params.tradeExecution === 'N1_open' && historicalData[i+1] ? historicalData[i+1].date : currentDate, 
                        currentCapital, position);
                    currentCapital = updatedCapital;
                    position = updatedPosition;
                }
            }
        }

        // Daily Portfolio Update
        let currentPortfolioValue = currentCapital;
        if (position.type === 'long') {
            currentPortfolioValue = position.shares * currentDayData.close + currentCapital;
        } else if (position.type === 'short') {
            // For short, equity is current cash + initial margin (valueAtEntry) - current cost to cover
            currentPortfolioValue = currentCapital + position.valueAtEntry - (position.shares * currentDayData.close);
        }
        equityCurve.push({ date: currentDate, value: currentPortfolioValue });
        
        if (buyAndHoldShares > 0) {
             buyAndHoldPortfolioValue = buyAndHoldShares * currentDayData.close;
        }
    }
    
    // Finalize if still in position at the end
    if (position.type) {
        const lastDayData = historicalData[historicalData.length - 1];
        const exitPrice = lastDayData.close; // Exit at last day's close
         const { updatedCapital, updatedPosition } = executeExit(exitPrice, lastDayData.date, "EndOfTest", position, currentCapital);
        currentCapital = updatedCapital;
        position = updatedPosition;
        // Update equity curve one last time with final capital after closing position
        equityCurve[equityCurve.length -1].value = currentCapital;
    }


    const totalReturn = ((currentCapital / params.initialCapital) - 1) * 100;
    const buyAndHoldReturn = buyAndHoldShares > 0 ? ((buyAndHoldPortfolioValue / params.initialCapital) - 1) * 100 : 0;
    
    const firstDate = new Date(historicalData[0]?.date || params.startDate);
    const lastDate = new Date(historicalData[historicalData.length-1]?.date || params.endDate);
    const daysInTest = Math.max(1, (lastDate - firstDate) / (1000 * 60 * 60 * 24)); // Avoid division by zero
    const yearsInTest = daysInTest / 365.25;
    
    let annualizedReturn = 0;
    if (yearsInTest > 0) {
        annualizedReturn = (Math.pow(currentCapital / params.initialCapital, 1 / yearsInTest) - 1) * 100;
    } else if (totalReturn !== 0) { // If test is too short, use total return as non-annualized
        annualizedReturn = totalReturn; // Or could be set to N/A
    }


    return {
        paramsUsed: params,
        equityCurve: equityCurve,
        trades: trades,
        finalCapital: currentCapital,
        totalReturn: totalReturn,
        annualizedReturn: annualizedReturn,
        buyAndHoldReturn: buyAndHoldReturn,
    };
}


// --- Web Worker Message Handler ---
self.onmessage = async function(event) {
    const { command, params } = event.data;

    if (command === 'fetchData') {
        try {
            if (!params || !params.stockCode || !params.startDate || !params.endDate) {
                 throw new Error("Missing parameters for fetchData command.");
            }
            const { stockCode, startDate, endDate } = params;
            self.postMessage({ type: 'progress', message: `Received fetchData command for ${stockCode} from ${startDate} to ${endDate}.` });
            const historicalData = await WorkspaceStockData(stockCode, startDate, endDate);
            self.postMessage({ type: 'dataReady', data: historicalData, params: params }); // Echo back params
        } catch (error) {
            console.error("Error in fetchData command:", error);
            self.postMessage({ type: 'error', message: error.message || 'Failed to fetch data in worker', params: params });
        }
    } else if (command === 'runBacktest') {
        try {
            self.postMessage({ type: 'progress', message: `Backtest started for ${params.stockCode}. Fetching/checking data...` });
            // Assuming params contains { stockCode, startDate, endDate, backtestParams }
            const historicalData = await WorkspaceStockData(params.stockCode, params.startDate, params.endDate);
            
            if (!historicalData || historicalData.length < 2) { // Need at least 2 days for prev/current logic
                throw new Error('Not enough historical data to run backtest (minimum 2 days required).');
            }
            self.postMessage({ type: 'progress', message: `Data ready. Running strategy for ${params.stockCode}.` });
            const result = runStrategy(params.backtestParams, historicalData);
            self.postMessage({ type: 'backtestResult', data: result });
        } catch (error) {
            console.error("Error in runBacktest command:", error);
            self.postMessage({ type: 'error', message: 'Backtest failed: ' + error.message, details: error.stack });
        }
    }
};

console.log("Backtest worker script loaded and ready (with backtesting engine).");
self.postMessage({ type: 'workerReady' }); // Inform main thread that worker is ready
