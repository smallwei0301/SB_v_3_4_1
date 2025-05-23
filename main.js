const strategyDescriptions = {
    maCross: {
        name: "均線黃金交叉/死亡交叉 (Moving Average Crossover)",
        description: "短期均線向上穿越長期均線時買入，反之賣出。",
        params: {
            shortMA: { label: "短期均線週期", type: "number", defaultValue: 10, min: 1, step: 1 },
            longMA: { label: "長期均線週期", type: "number", defaultValue: 30, min: 1, step: 1 }
        },
        optimizerParams: {
            shortMA: { label: "短期MA", from: 5, to: 50, step: 1 },
            longMA: { label: "長期MA", from: 20, to: 100, step: 5 }
        }
    },
    rsiBasic: {
        name: "RSI超賣/超買 (RSI Oversold/Overbought)",
        description: "RSI 低於超賣區買入，高於超買區賣出。",
        params: {
            rsiPeriod: { label: "RSI 週期", type: "number", defaultValue: 14, min: 1, step: 1 },
            rsiOversold: { label: "RSI 超賣閾值", type: "number", defaultValue: 30, min: 0, max: 100, step: 1 },
            rsiOverbought: { label: "RSI 超買閾值", type: "number", defaultValue: 70, min: 0, max: 100, step: 1 }
        },
        optimizerParams: {
            rsiPeriod: { label: "RSI 週期", from: 7, to: 28, step: 1 },
            rsiOversold: { label: "RSI 超賣", from: 20, to: 40, step: 1 },
            rsiOverbought: { label: "RSI 超買", from: 60, to: 80, step: 1 }
        }
    }
};

document.addEventListener('DOMContentLoaded', () => {
    // DOM Element References
    const stockCodeInput = document.getElementById('stockCode');
    const startDateInput = document.getElementById('startDate');
    const endDateInput = document.getElementById('endDate');
    const initialCapitalInput = document.getElementById('initialCapital');
    const nYearsInput = document.getElementById('nYearsInput');
    const nYearsApplyButton = document.getElementById('nYearsApplyButton');
    const buyFeeInput = document.getElementById('buyFeeInput');
    const sellFeeInput = document.getElementById('sellFeeInput');
    const enableShortSellingCheckbox = document.getElementById('enableShortSellingCheckbox');
    const shortSellingSection = document.getElementById('shortSellingSection');
    const shortInterestRateInput = document.getElementById('shortInterestRate');

    // Strategy DOM Elements
    const longEntryStrategySelect = document.getElementById('longEntryStrategySelect');
    const longEntryParamsContainer = document.getElementById('longEntryParamsContainer');
    const longExitStrategySelect = document.getElementById('longExitStrategySelect');
    const longExitParamsContainer = document.getElementById('longExitParamsContainer');
    const shortEntryStrategySelect = document.getElementById('shortEntryStrategySelect');
    const shortEntryParamsContainer = document.getElementById('shortEntryParamsContainer');
    const shortExitStrategySelect = document.getElementById('shortExitStrategySelect');
    const shortExitParamsContainer = document.getElementById('shortExitParamsContainer');

    // New Backtest Setting DOM Elements
    const tradeExecutionSelect = document.getElementById('tradeExecutionSelect');
    const positionSizingBasisSelect = document.getElementById('positionSizingBasisSelect');
    const positionSizePercentageInput = document.getElementById('positionSizePercentageInput');
    const stopLossInput = document.getElementById('stopLossInput');
    const takeProfitInput = document.getElementById('takeProfitInput');
    
    // Short selling specific settings (already in HTML, just getting references)
    const shortPositionSizingBasisSelect = document.getElementById('shortPositionSizingBasisSelect');
    const shortPositionSizePercentageInput = document.getElementById('shortPositionSizePercentageInput');
    const shortStopLossInput = document.getElementById('shortStopLossInput');
    const shortTakeProfitInput = document.getElementById('shortTakeProfitInput');


    const runBacktestButton = document.getElementById('runBacktestButton');
    const logOutput = document.getElementById('logOutput');
    const summaryOutputPre = document.querySelector('#summaryOutput pre');
    const equityChartCanvas = document.getElementById('equityChart');
    let equityChart = null; // To store Chart.js instance

    // --- Web Worker Initialization ---
    let worker;
    try {
        const workerScriptContent = document.getElementById('backtest-worker-script').textContent;
        if (!workerScriptContent || workerScriptContent.trim() === "") {
            throw new Error("Worker script content is empty. Ensure backtest-worker.js is embedded in index.html.");
        }
        const workerBlob = new Blob([workerScriptContent], { type: 'application/javascript' });
        const workerUrl = URL.createObjectURL(workerBlob);
        worker = new Worker(workerUrl);
        runBacktestButton.disabled = true; // Disable button until worker is ready
        logOutput.textContent = 'Initializing Web Worker...';
    } catch (error) {
        console.error("Failed to initialize Web Worker:", error);
        logOutput.textContent = `Error initializing Web Worker: ${error.message}. Please ensure the worker script is correctly embedded in index.html.`;
        if (runBacktestButton) runBacktestButton.disabled = true;
        // Further execution that depends on the worker should be halted.
        return; 
    }


    // --- Helper: Get Strategy Parameters ---
    function getStrategyParamsFromContainer(containerElement) {
        const params = {};
        if (!containerElement) return params;

        const inputs = containerElement.querySelectorAll('input, select');
        inputs.forEach(input => {
            const key = input.name || input.id.split('_').pop(); // Prefer name, fallback to part of ID
            if (input.type === 'number') {
                params[key] = parseFloat(input.value);
            } else if (input.type === 'checkbox') {
                params[key] = input.checked;
            } else {
                params[key] = input.value;
            }
        });
        return params;
    }
    
    // --- Populate Strategy Dropdowns & Params (existing code) ---
    function populateStrategyDropdowns(selectElement) {
        if (!selectElement) return;
        selectElement.innerHTML = ''; 
        const noneOption = document.createElement('option');
        noneOption.value = ""; 
        noneOption.textContent = "無 (None)";
        selectElement.appendChild(noneOption);
        for (const strategyId in strategyDescriptions) {
            const strategy = strategyDescriptions[strategyId];
            const option = document.createElement('option');
            option.value = strategyId;
            option.textContent = strategy.name;
            selectElement.appendChild(option);
        }
    }

    function updateStrategyParams(strategyId, paramsContainerElement) {
        if (!paramsContainerElement) return;
        paramsContainerElement.innerHTML = ''; 
        if (!strategyId || !strategyDescriptions[strategyId]) return;

        const strategy = strategyDescriptions[strategyId];
        if (strategy.params) {
            for (const paramKey in strategy.params) {
                const paramDef = strategy.params[paramKey];
                const paramGroup = document.createElement('div');
                paramGroup.className = 'input-group';
                const label = document.createElement('label');
                label.htmlFor = `${paramsContainerElement.id}_${paramKey}`;
                label.textContent = paramDef.label;
                paramGroup.appendChild(label);

                if (paramDef.type === 'select') {
                    const select = document.createElement('select');
                    select.id = `${paramsContainerElement.id}_${paramKey}`;
                    select.name = paramKey;
                    select.className = 'form-select w-full';
                    if (paramDef.options) {
                        paramDef.options.forEach(opt => {
                            const optionElement = document.createElement('option');
                            optionElement.value = opt.value;
                            optionElement.textContent = opt.text;
                            if (opt.value === paramDef.defaultValue) optionElement.selected = true;
                            select.appendChild(optionElement);
                        });
                    }
                    paramGroup.appendChild(select);
                } else {
                    const input = document.createElement('input');
                    input.type = paramDef.type;
                    input.id = `${paramsContainerElement.id}_${paramKey}`;
                    input.name = paramKey;
                    input.value = paramDef.defaultValue;
                    input.className = 'form-input w-full';
                    if (paramDef.min !== undefined) input.min = paramDef.min;
                    if (paramDef.max !== undefined) input.max = paramDef.max;
                    if (paramDef.step !== undefined) input.step = paramDef.step;
                    paramGroup.appendChild(input);
                }
                paramsContainerElement.appendChild(paramGroup);
            }
        }
    }
    // Initial population and event listeners for strategies
    [longEntryStrategySelect, longExitStrategySelect, shortEntryStrategySelect, shortExitStrategySelect].forEach(sel => populateStrategyDropdowns(sel));
    longEntryStrategySelect.addEventListener('change', () => updateStrategyParams(longEntryStrategySelect.value, longEntryParamsContainer));
    longExitStrategySelect.addEventListener('change', () => updateStrategyParams(longExitStrategySelect.value, longExitParamsContainer));
    shortEntryStrategySelect.addEventListener('change', () => updateStrategyParams(shortEntryStrategySelect.value, shortEntryParamsContainer));
    shortExitStrategySelect.addEventListener('change', () => updateStrategyParams(shortExitStrategySelect.value, shortExitParamsContainer));
    
    // Trigger initial param display for default selected strategies (e.g., first one)
    if (longEntryStrategySelect.options.length > 1) { longEntryStrategySelect.value = longEntryStrategySelect.options[1].value; updateStrategyParams(longEntryStrategySelect.value, longEntryParamsContainer); }
    if (longExitStrategySelect.options.length > 1) { longExitStrategySelect.value = longExitStrategySelect.options[1].value; updateStrategyParams(longExitStrategySelect.value, longExitParamsContainer); }
    if (shortEntryStrategySelect.options.length > 1) { shortEntryStrategySelect.value = shortEntryStrategySelect.options[1].value; updateStrategyParams(shortEntryStrategySelect.value, shortEntryParamsContainer); }
    if (shortExitStrategySelect.options.length > 1) { shortExitStrategySelect.value = shortExitStrategySelect.options[1].value; updateStrategyParams(shortExitStrategySelect.value, shortExitParamsContainer); }


    // --- Run Backtest Button Event Listener ---
    runBacktestButton.addEventListener('click', () => {
        logOutput.textContent = 'Starting backtest...\n';
        summaryOutputPre.textContent = '';
        if (equityChart) equityChart.destroy();
        runBacktestButton.disabled = true;

        const backtestParams = {
            initialCapital: parseFloat(initialCapitalInput.value),
            buyFeeRate: parseFloat(buyFeeInput.value),
            sellFeeRate: parseFloat(sellFeeInput.value),
            tradeExecution: tradeExecutionSelect.value,
            
            // Long position settings
            positionSizingBasis: positionSizingBasisSelect.value,
            positionSizePercentage: parseFloat(positionSizePercentageInput.value),
            fixedStopLossPercentage: parseFloat(stopLossInput.value),
            fixedTakeProfitPercentage: parseFloat(takeProfitInput.value),

            enableShortSelling: enableShortSellingCheckbox.checked,
            // Short position settings (conditional)
            shortInterestRate: enableShortSellingCheckbox.checked ? parseFloat(shortInterestRateInput.value) : 0,
            shortPositionSizingBasis: enableShortSellingCheckbox.checked ? shortPositionSizingBasisSelect.value : positionSizingBasisSelect.value, // Default to long if not enabled
            shortPositionSizePercentage: enableShortSellingCheckbox.checked ? parseFloat(shortPositionSizePercentageInput.value) : parseFloat(positionSizePercentageInput.value),
            shortFixedStopLossPercentage: enableShortSellingCheckbox.checked ? parseFloat(shortStopLossInput.value) : 0,
            shortFixedTakeProfitPercentage: enableShortSellingCheckbox.checked ? parseFloat(shortTakeProfitInput.value) : 0,


            longEntryStrategy: longEntryStrategySelect.value ? {
                id: longEntryStrategySelect.value,
                params: getStrategyParamsFromContainer(longEntryParamsContainer)
            } : null,
            longExitStrategy: longExitStrategySelect.value ? {
                id: longExitStrategySelect.value,
                params: getStrategyParamsFromContainer(longExitParamsContainer)
            } : null,
            shortEntryStrategy: enableShortSellingCheckbox.checked && shortEntryStrategySelect.value ? {
                id: shortEntryStrategySelect.value,
                params: getStrategyParamsFromContainer(shortEntryParamsContainer)
            } : null,
            shortExitStrategy: enableShortSellingCheckbox.checked && shortExitStrategySelect.value ? {
                id: shortExitStrategySelect.value,
                params: getStrategyParamsFromContainer(shortExitParamsContainer)
            } : null,
        };
        
        console.log('Sending parameters to worker:', backtestParams);
        worker.postMessage({
            command: 'runBacktest',
            params: { // This 'params' object is what the worker receives as event.data.params
                stockCode: stockCodeInput.value,
                startDate: startDateInput.value,
                endDate: endDateInput.value,
                backtestParams: backtestParams 
            }
        });
    });

    // --- Main Worker Message Handler ---
    worker.onmessage = function(event) {
        switch (event.data.type) {
            case 'workerReady':
                console.log('Web Worker is ready.');
                logOutput.textContent = 'Worker ready. Please configure and run backtest.';
                runBacktestButton.disabled = false;
                break;
            case 'progress':
                console.log('Worker Progress:', event.data.message);
                logOutput.textContent += event.data.message + '\n';
                break;
            case 'dataReady': // Might be used if fetchData is separate later
                console.log('Worker: Data is ready (potentially cached)', event.data.data);
                logOutput.textContent += 'Historical data is ready.\n';
                // cachedStockData = event.data.data; // If you plan to cache on main thread
                break;
            case 'backtestResult':
                console.log('Worker: Backtest Result Received:', event.data.data);
                logOutput.textContent += 'Backtest finished.\nDisplaying results...\n';
                displaySummary(event.data.data);
                renderChart(event.data.data.equityCurve);
                runBacktestButton.disabled = false;
                break;
            case 'error':
                console.error('Worker Error:', event.data.message, event.data.details || '');
                logOutput.textContent += `ERROR: ${event.data.message}\n${event.data.details || ''}\n`;
                runBacktestButton.disabled = false;
                break;
            default:
                console.log('Message from worker:', event.data);
        }
    };
    
    worker.onerror = function(error) {
        console.error("Unhandled worker error:", error);
        logOutput.textContent += `CRITICAL WORKER ERROR: ${error.message}\nCheck console for details. Path: ${error.filename}:${error.lineno}\n`;
        runBacktestButton.disabled = false;
    };

    // --- Display Functions (to be fully implemented in next steps) ---
    function displaySummary(results) {
        summaryOutputPre.textContent = `Backtest Summary for ${results.paramsUsed.stockCode || stockCodeInput.value}:\n` +
            `------------------------------------------\n` +
            `Initial Capital: ${results.paramsUsed.initialCapital.toLocaleString()}\n` +
            `Final Capital: ${results.finalCapital.toLocaleString(undefined, {minimumFractionDigits: 2, maximumFractionDigits: 2})}\n` +
            `Total Return: ${results.totalReturn.toFixed(2)}%\n` +
            `Annualized Return: ${results.annualizedReturn.toFixed(2)}%\n` +
            `Buy and Hold Return: ${results.buyAndHoldReturn.toFixed(2)}%\n` +
            `Number of Trades: ${results.trades.length}\n` +
            `------------------------------------------\n\n` +
            `Trades:\n` +
            results.trades.map(t => 
                `${t.type.toUpperCase()} ${t.entryDate} (${t.entryPrice.toFixed(2)}) -> ${t.exitDate} (${t.exitPrice.toFixed(2)}) | Shares: ${t.shares} | P/L: ${t.profit.toFixed(2)} | Reason: ${t.reason}`
            ).join('\n');
    }

    function renderChart(equityCurveData) {
        if (equityChartCanvas) {
            const ctx = equityChartCanvas.getContext('2d');
            if (equityChart) {
                equityChart.destroy(); // Destroy previous chart instance
            }
            equityChart = new Chart(ctx, {
                type: 'line',
                data: {
                    labels: equityCurveData.map(d => d.date),
                    datasets: [{
                        label: 'Equity Curve',
                        data: equityCurveData.map(d => d.value),
                        borderColor: 'rgb(75, 192, 192)',
                        tension: 0.1
                    }]
                },
                options: {
                    responsive: true,
                    maintainAspectRatio: true, // Or false if you want to control size via CSS strictly
                    scales: {
                        x: { title: { display: true, text: 'Date' } },
                        y: { title: { display: true, text: 'Portfolio Value' } }
                    }
                }
            });
        }
    }

    // --- Existing JS for UI (setDefaultFees, nYearsApplyButton, enableShortSellingCheckbox, etc.) ---
    function setDefaultFees() {
        const stockCode = stockCodeInput.value;
        if (stockCode.startsWith("00")) {
            buyFeeInput.value = "0.1";
            sellFeeInput.value = "0.2";
        } else {
            buyFeeInput.value = "0.1425";
            sellFeeInput.value = "0.4425";
        }
    }
    stockCodeInput.addEventListener('input', setDefaultFees);

    nYearsApplyButton.addEventListener('click', () => {
        const nYears = parseInt(nYearsInput.value);
        if (nYears > 0) {
            let refDateValue = endDateInput.value;
            let refDate;
            if (refDateValue) refDate = new Date(refDateValue);
            else {
                refDate = new Date();
                endDateInput.value = refDate.toISOString().split('T')[0];
            }
            const calculatedStartDate = new Date(refDate);
            calculatedStartDate.setFullYear(refDate.getFullYear() - nYears);
            startDateInput.value = calculatedStartDate.toISOString().split('T')[0];
        }
    });

    enableShortSellingCheckbox.addEventListener('change', () => {
        shortSellingSection.style.display = enableShortSellingCheckbox.checked ? 'block' : 'none';
    });

    // Initial Calls & Default States
    if (!stockCodeInput.value && stockCodeInput.defaultValue === "") stockCodeInput.value = "2330";
    initialCapitalInput.value = "100000";
    if (!nYearsInput.value && nYearsInput.defaultValue === "") nYearsInput.value = "5";
    const today = new Date();
    if (!endDateInput.value && endDateInput.defaultValue === "") endDateInput.value = today.toISOString().split('T')[0];
    if (!startDateInput.value && startDateInput.defaultValue === "") {
        const currentEndDate = new Date(endDateInput.value);
        const defaultNYears = parseInt(nYearsInput.value) || 5;
        const defaultStartDate = new Date(currentEndDate);
        defaultStartDate.setFullYear(currentEndDate.getFullYear() - defaultNYears);
        startDateInput.value = defaultStartDate.toISOString().split('T')[0];
    }
    setDefaultFees();
});
