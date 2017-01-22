app.controller("remittanceListController", [ '$scope', '$location', '$http', '$q', '$window', '$timeout', function($scope , $location, $http, $q, $window, $timeout) {

    $scope.account = null;
    $scope.balance = "";
    $scope.currentBlock = 0;
    $scope.remittancesAddress = "";
    $scope.remittancesObject = {};
    $scope.logRemittanceAdded = null;
    $scope.logRemittanceCollected = null;
    $scope.logRemittanceReturned = null;
    $scope.newRemittance = {
        agentCode: "0x" + Math.floor(Math.random() * 4294967295).toString(16)
            + Math.floor(Math.random() * 4294967295).toString(16),
        receiverCode: "0x" + Math.floor(Math.random() * 4294967295).toString(16)
            + Math.floor(Math.random() * 4294967295).toString(16),
        blockDeadline: 0
    };
    $scope.collectRemittance = {
        agentCode: "",
        receiverCode: "",
        hash: ""
    };

    $window.onload = function() {
        prepareWeb3(web3);
        web3.eth.filter().watch(function (err, value) {
            if (err) {
                console.error(err);
            } else {
                $timeout(function() {
                    $scope.currentBlock = value.blockNumber;
                });
            }
        });

        return web3.eth.getAccountsPromise()
            .then(function (accs) {
                var next;
                if ((typeof accs === "array" || typeof accs === "object")
                    && accs.length > 0) {
                    $scope.account = accs[0];
                    console.log("account: " + $scope.account)
                    next = $scope.refreshBalance()
                        .then(function() {
                            return web3.version.getNetworkPromise();    
                        });
                } else {
                    next = web3.version.getNetworkPromise();
                }
                return next;
            })
            .then(function(network) {
                console.log("Network: " + network);
                Remittances.setNetwork(network);
                $timeout(function() {
                    $scope.remittancesAddress = Remittances.deployed().address;
                });
                return $scope.prepareNewRemittance();
            })
            .then(function () {
                $scope.logRemittanceAdded = Remittances.deployed()
                    .LogRemittanceAdded({}, { fromBlock: 389343 });
                $scope.logRemittanceCollected = Remittances.deployed()
                    .LogRemittanceCollected({}, { fromBlock: 389343 });
                $scope.logRemittanceReturned = Remittances.deployed()
                    .LogRemittanceReturned({}, { fromBlock: 389343 });
                $scope.loadRemittances();
            })
            .catch(console.error);
    };

    $scope.refreshBalance = function() {
        return web3.eth.getBalancePromise($scope.account)
            .then(function(value) {
                console.log("balance: " + value.toString(10));
                $timeout(function () {
                    $scope.balance = web3.fromWei(value, "finney").toString(10);
                });
            }).catch(function(e) {
                console.error(e);
            });
    };

    $scope.prepareNewRemittance = function() {
        var blockNumber;
        return web3.eth.getBlockNumberPromise()
            .then(function (_blockNumber) {
                blockNumber = _blockNumber;
                $scope.currentBlock = blockNumber;
                console.log(blockNumber);
                return Remittances.deployed().maxNumberOfBlocksInFuture.call();
            })
            .then(function(maxNumber) {
                console.log(maxNumber);
                $timeout(function() {
                    $scope.newRemittance.blockDeadline = 
                        web3.toBigNumber(blockNumber).plus(maxNumber).toString(10);
                });
            })
            .catch(function (err) {
                console.error(err);
            });
    };

    $scope.loadRemittances = function() {
        $scope.logRemittanceAdded.watch(function (err, eventAdded) {
            if (err) {
                console.log(err.toString());
            } else {
                var args = eventAdded.args;
                $timeout(function() {
                    var remittance = $scope.remittancesObject[args.hash];
                    if (typeof remittance !== "undefined") {
                        if (remittance.status == "Adding") {
                            remittance.status = "Added";
                        }
                        remittance.blockDeadline = args.blockDeadline.toString(10);
                        remittance.value = web3.fromWei(args.value, "finney").toString(10);
                        remittance.toea = args.toea.toString(10);
                    } else {
                        $scope.remittancesObject[args.hash] = {
                            hash: args.hash,
                            sender: args.sender,
                            value: web3.fromWei(args.value, "finney").toString(10),
                            toea: args.toea.toString(10),
                            blockDeadline: args.blockDeadline.toString(10),
                            status: "Added"
                        };
                    }
                });
            }
        });
        $scope.logRemittanceCollected.watch(function (err, eventCollected) {
            if (err) {
                console.log(err.toString());
            } else {
                var args = eventCollected.args;
                $timeout(function() {
                    var remittance = $scope.remittancesObject[args.hash];
                    if (typeof remittance !== "undefined") {
                        remittance.status = "Collected";
                        remittance.agentCode = args.agentCode;
                        remittance.receiverCode = args.receiverCode;
                    } else {
                        $scope.remittancesObject[args.hash] = {
                            hash: args.hash,
                            sender: args.sender,
                            status: "Collected",
                            agentCode: args.agentCode,
                            receiverCode: args.receiverCode
                        };
                    }
                });
            }
        });
        $scope.logRemittanceReturned.watch(function (err, eventReturned) {
            if (err) {
                console.log(err.toString());
            } else {
                var args = eventReturned.args;
                $timeout(function() {
                    var remittance = $scope.remittancesObject[args.hash];
                    if (typeof remittance !== "undefined") {
                        remittance.status = "Returned";
                    } else {
                        $scope.remittancesObject[args.hash] = {
                            hash: args.hash,
                            sender: args.sender,
                            status: "Returned"
                        };                        
                    }
                });
            }
        });
    };

    $scope.sendRemittance = function(amount, toea, agentCode, receiverCode, blockDeadline) {
        console.log(amount);
        console.log(agentCode);
        console.log(receiverCode);
        console.log(blockDeadline);
        var hash, value;
        return Remittances.deployed()
            .anonymise.call(agentCode, receiverCode)
            .then(function (_hash) {
                hash = _hash;
                value = web3.toWei(amount, "finney");
                return Remittances.deployed().sendTo.call(
                    hash, toea, blockDeadline,
                    { from: $scope.account, value: value })
            })
            .then(function (success) {
                if (success) {
                    return Remittances.deployed().sendTo.sendTransaction(
                        hash, toea, blockDeadline,
                        { from: $scope.account, value: value });
                } else {
                    alert("You cannot send this remittance");
                    throw "Invalid send";                    
                }
            })
            .then(function (txHash) {
                $timeout(function() {
                    $scope.remittancesObject[hash] = {
                        hash: hash,
                        sender: $scope.account,
                        value: amount,
                        toea: toea,
                        blockDeadline: blockDeadline,
                        status: "Adding"
                    };
                });
                return web3.eth.getTransactionReceiptMined(txHash);
            })
            .then(function (receipt) {
                console.log(receipt);
                $timeout(function() {
                    $scope.remittancesObject[hash].adding = false;
                });
                return $scope.refreshBalance();
            })
            .catch(function (err) {
                console.error(err);
            });
    };

    $scope.testRemittance = function(agentCode, receiverCode) {
        return Remittances.deployed().anonymise.call(agentCode, receiverCode)
            .then(function (_hash) {
                $timeout(function() {
                    $scope.collectRemittance.hash = _hash;
                });
            })
            .catch(function(err) {
                console.error(err);
            });
    };

    $scope.collectRemittance = function(agentCode, receiverCode) {
        var hash;
        return Remittances.deployed().anonymise.call(agentCode, receiverCode)
            .then(function (_hash) {
                hash = _hash;
                return Remittances.deployed().collect.call(
                    agentCode, receiverCode, { from: $scope.account });
            })
            .then(function (success) {
                if (success) {
                    return Remittances.deployed().collect.sendTransaction(
                        agentCode, receiverCode, { from: $scope.account });
                } else {
                    alert("This is not a valid combination");
                    throw "Invalid codes";
                }
            })
            .then(function (txHash) {
                console.log(txHash);
                $timeout(function() {
                    var remittance = $scope.remittancesObject[hash];
                    if (typeof remittance !== "undefined") {
                        remittance.status = "Collecting";
                    }
                });
                return web3.eth.getTransactionReceiptMined(txHash);
            })
            .then(function (receipt) {
                console.log(receipt);
                return $scope.refreshBalance();
            })
            .catch(function (err) {
                console.error(err);
            });
    };

    $scope.returnRemittance = function(hash) {
        return Remittances.deployed().returnToSender.call(
                hash, { from: $scope.account })
            .then(function (success) {
                if (success) {
                    return Remittances.deployed().returnToSender.sendTransaction(
                        hash, { from: $scope.account });
                } else {
                    alert("You cannot return this remittance");
                    throw "Invalid parameters";
                }
            })
            .then(function (txHash) {
                console.log(txHash);
                $timeout(function() {
                    var remittance = $scope.remittancesObject[hash];
                    if (typeof remittance !== "undefined") {
                        remittance.status = "Returning";
                    }
                });
                return web3.eth.getTransactionReceiptMined(txHash);
            })
            .then(function (receipt) {
                console.log(receipt);
                return $scope.refreshBalance();
            })
            .catch(function (err) {
                console.error(err);
            });
    }

}]);