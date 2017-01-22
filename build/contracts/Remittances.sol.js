var Web3 = require("web3");
var SolidityEvent = require("web3/lib/web3/event.js");

(function() {
  // Planned for future features, logging, etc.
  function Provider(provider) {
    this.provider = provider;
  }

  Provider.prototype.send = function() {
    this.provider.send.apply(this.provider, arguments);
  };

  Provider.prototype.sendAsync = function() {
    this.provider.sendAsync.apply(this.provider, arguments);
  };

  var BigNumber = (new Web3()).toBigNumber(0).constructor;

  var Utils = {
    is_object: function(val) {
      return typeof val == "object" && !Array.isArray(val);
    },
    is_big_number: function(val) {
      if (typeof val != "object") return false;

      // Instanceof won't work because we have multiple versions of Web3.
      try {
        new BigNumber(val);
        return true;
      } catch (e) {
        return false;
      }
    },
    merge: function() {
      var merged = {};
      var args = Array.prototype.slice.call(arguments);

      for (var i = 0; i < args.length; i++) {
        var object = args[i];
        var keys = Object.keys(object);
        for (var j = 0; j < keys.length; j++) {
          var key = keys[j];
          var value = object[key];
          merged[key] = value;
        }
      }

      return merged;
    },
    promisifyFunction: function(fn, C) {
      var self = this;
      return function() {
        var instance = this;

        var args = Array.prototype.slice.call(arguments);
        var tx_params = {};
        var last_arg = args[args.length - 1];

        // It's only tx_params if it's an object and not a BigNumber.
        if (Utils.is_object(last_arg) && !Utils.is_big_number(last_arg)) {
          tx_params = args.pop();
        }

        tx_params = Utils.merge(C.class_defaults, tx_params);

        return new Promise(function(accept, reject) {
          var callback = function(error, result) {
            if (error != null) {
              reject(error);
            } else {
              accept(result);
            }
          };
          args.push(tx_params, callback);
          fn.apply(instance.contract, args);
        });
      };
    },
    synchronizeFunction: function(fn, instance, C) {
      var self = this;
      return function() {
        var args = Array.prototype.slice.call(arguments);
        var tx_params = {};
        var last_arg = args[args.length - 1];

        // It's only tx_params if it's an object and not a BigNumber.
        if (Utils.is_object(last_arg) && !Utils.is_big_number(last_arg)) {
          tx_params = args.pop();
        }

        tx_params = Utils.merge(C.class_defaults, tx_params);

        return new Promise(function(accept, reject) {

          var decodeLogs = function(logs) {
            return logs.map(function(log) {
              var logABI = C.events[log.topics[0]];

              if (logABI == null) {
                return null;
              }

              var decoder = new SolidityEvent(null, logABI, instance.address);
              return decoder.decode(log);
            }).filter(function(log) {
              return log != null;
            });
          };

          var callback = function(error, tx) {
            if (error != null) {
              reject(error);
              return;
            }

            var timeout = C.synchronization_timeout || 240000;
            var start = new Date().getTime();

            var make_attempt = function() {
              C.web3.eth.getTransactionReceipt(tx, function(err, receipt) {
                if (err) return reject(err);

                if (receipt != null) {
                  // If they've opted into next gen, return more information.
                  if (C.next_gen == true) {
                    return accept({
                      tx: tx,
                      receipt: receipt,
                      logs: decodeLogs(receipt.logs)
                    });
                  } else {
                    return accept(tx);
                  }
                }

                if (timeout > 0 && new Date().getTime() - start > timeout) {
                  return reject(new Error("Transaction " + tx + " wasn't processed in " + (timeout / 1000) + " seconds!"));
                }

                setTimeout(make_attempt, 1000);
              });
            };

            make_attempt();
          };

          args.push(tx_params, callback);
          fn.apply(self, args);
        });
      };
    }
  };

  function instantiate(instance, contract) {
    instance.contract = contract;
    var constructor = instance.constructor;

    // Provision our functions.
    for (var i = 0; i < instance.abi.length; i++) {
      var item = instance.abi[i];
      if (item.type == "function") {
        if (item.constant == true) {
          instance[item.name] = Utils.promisifyFunction(contract[item.name], constructor);
        } else {
          instance[item.name] = Utils.synchronizeFunction(contract[item.name], instance, constructor);
        }

        instance[item.name].call = Utils.promisifyFunction(contract[item.name].call, constructor);
        instance[item.name].sendTransaction = Utils.promisifyFunction(contract[item.name].sendTransaction, constructor);
        instance[item.name].request = contract[item.name].request;
        instance[item.name].estimateGas = Utils.promisifyFunction(contract[item.name].estimateGas, constructor);
      }

      if (item.type == "event") {
        instance[item.name] = contract[item.name];
      }
    }

    instance.allEvents = contract.allEvents;
    instance.address = contract.address;
    instance.transactionHash = contract.transactionHash;
  };

  // Use inheritance to create a clone of this contract,
  // and copy over contract's static functions.
  function mutate(fn) {
    var temp = function Clone() { return fn.apply(this, arguments); };

    Object.keys(fn).forEach(function(key) {
      temp[key] = fn[key];
    });

    temp.prototype = Object.create(fn.prototype);
    bootstrap(temp);
    return temp;
  };

  function bootstrap(fn) {
    fn.web3 = new Web3();
    fn.class_defaults  = fn.prototype.defaults || {};

    // Set the network iniitally to make default data available and re-use code.
    // Then remove the saved network id so the network will be auto-detected on first use.
    fn.setNetwork("default");
    fn.network_id = null;
    return fn;
  };

  // Accepts a contract object created with web3.eth.contract.
  // Optionally, if called without `new`, accepts a network_id and will
  // create a new version of the contract abstraction with that network_id set.
  function Contract() {
    if (this instanceof Contract) {
      instantiate(this, arguments[0]);
    } else {
      var C = mutate(Contract);
      var network_id = arguments.length > 0 ? arguments[0] : "default";
      C.setNetwork(network_id);
      return C;
    }
  };

  Contract.currentProvider = null;

  Contract.setProvider = function(provider) {
    var wrapped = new Provider(provider);
    this.web3.setProvider(wrapped);
    this.currentProvider = provider;
  };

  Contract.new = function() {
    if (this.currentProvider == null) {
      throw new Error("Remittances error: Please call setProvider() first before calling new().");
    }

    var args = Array.prototype.slice.call(arguments);

    if (!this.unlinked_binary) {
      throw new Error("Remittances error: contract binary not set. Can't deploy new instance.");
    }

    var regex = /__[^_]+_+/g;
    var unlinked_libraries = this.binary.match(regex);

    if (unlinked_libraries != null) {
      unlinked_libraries = unlinked_libraries.map(function(name) {
        // Remove underscores
        return name.replace(/_/g, "");
      }).sort().filter(function(name, index, arr) {
        // Remove duplicates
        if (index + 1 >= arr.length) {
          return true;
        }

        return name != arr[index + 1];
      }).join(", ");

      throw new Error("Remittances contains unresolved libraries. You must deploy and link the following libraries before you can deploy a new version of Remittances: " + unlinked_libraries);
    }

    var self = this;

    return new Promise(function(accept, reject) {
      var contract_class = self.web3.eth.contract(self.abi);
      var tx_params = {};
      var last_arg = args[args.length - 1];

      // It's only tx_params if it's an object and not a BigNumber.
      if (Utils.is_object(last_arg) && !Utils.is_big_number(last_arg)) {
        tx_params = args.pop();
      }

      tx_params = Utils.merge(self.class_defaults, tx_params);

      if (tx_params.data == null) {
        tx_params.data = self.binary;
      }

      // web3 0.9.0 and above calls new twice this callback twice.
      // Why, I have no idea...
      var intermediary = function(err, web3_instance) {
        if (err != null) {
          reject(err);
          return;
        }

        if (err == null && web3_instance != null && web3_instance.address != null) {
          accept(new self(web3_instance));
        }
      };

      args.push(tx_params, intermediary);
      contract_class.new.apply(contract_class, args);
    });
  };

  Contract.at = function(address) {
    if (address == null || typeof address != "string" || address.length != 42) {
      throw new Error("Invalid address passed to Remittances.at(): " + address);
    }

    var contract_class = this.web3.eth.contract(this.abi);
    var contract = contract_class.at(address);

    return new this(contract);
  };

  Contract.deployed = function() {
    if (!this.address) {
      throw new Error("Cannot find deployed address: Remittances not deployed or address not set.");
    }

    return this.at(this.address);
  };

  Contract.defaults = function(class_defaults) {
    if (this.class_defaults == null) {
      this.class_defaults = {};
    }

    if (class_defaults == null) {
      class_defaults = {};
    }

    var self = this;
    Object.keys(class_defaults).forEach(function(key) {
      var value = class_defaults[key];
      self.class_defaults[key] = value;
    });

    return this.class_defaults;
  };

  Contract.extend = function() {
    var args = Array.prototype.slice.call(arguments);

    for (var i = 0; i < arguments.length; i++) {
      var object = arguments[i];
      var keys = Object.keys(object);
      for (var j = 0; j < keys.length; j++) {
        var key = keys[j];
        var value = object[key];
        this.prototype[key] = value;
      }
    }
  };

  Contract.all_networks = {
  "3": {
    "abi": [
      {
        "constant": true,
        "inputs": [],
        "name": "maxNumberOfBlocksInFuture",
        "outputs": [
          {
            "name": "",
            "type": "uint256"
          }
        ],
        "payable": false,
        "type": "function"
      },
      {
        "constant": false,
        "inputs": [
          {
            "name": "agentCode",
            "type": "bytes8"
          },
          {
            "name": "receiverCode",
            "type": "bytes8"
          }
        ],
        "name": "collect",
        "outputs": [
          {
            "name": "success",
            "type": "bool"
          }
        ],
        "payable": false,
        "type": "function"
      },
      {
        "constant": false,
        "inputs": [
          {
            "name": "hash",
            "type": "bytes32"
          }
        ],
        "name": "returnToSender",
        "outputs": [
          {
            "name": "success",
            "type": "bool"
          }
        ],
        "payable": false,
        "type": "function"
      },
      {
        "constant": true,
        "inputs": [],
        "name": "getOwner",
        "outputs": [
          {
            "name": "owner",
            "type": "address"
          }
        ],
        "payable": false,
        "type": "function"
      },
      {
        "constant": true,
        "inputs": [
          {
            "name": "",
            "type": "bytes32"
          }
        ],
        "name": "remittances",
        "outputs": [
          {
            "name": "sender",
            "type": "address"
          },
          {
            "name": "amount",
            "type": "uint256"
          },
          {
            "name": "toea",
            "type": "uint256"
          },
          {
            "name": "blockDeadline",
            "type": "uint256"
          }
        ],
        "payable": false,
        "type": "function"
      },
      {
        "constant": false,
        "inputs": [
          {
            "name": "hash",
            "type": "bytes32"
          },
          {
            "name": "toea",
            "type": "uint256"
          },
          {
            "name": "blockDeadline",
            "type": "uint256"
          }
        ],
        "name": "sendTo",
        "outputs": [
          {
            "name": "success",
            "type": "bool"
          }
        ],
        "payable": true,
        "type": "function"
      },
      {
        "constant": true,
        "inputs": [
          {
            "name": "agentCode",
            "type": "bytes8"
          },
          {
            "name": "receiverCode",
            "type": "bytes8"
          }
        ],
        "name": "anonymise",
        "outputs": [
          {
            "name": "hash",
            "type": "bytes32"
          }
        ],
        "payable": false,
        "type": "function"
      },
      {
        "inputs": [
          {
            "name": "_maxNumberOfBlocksInFuture",
            "type": "uint256"
          }
        ],
        "payable": false,
        "type": "constructor"
      },
      {
        "anonymous": false,
        "inputs": [
          {
            "indexed": true,
            "name": "sender",
            "type": "address"
          },
          {
            "indexed": true,
            "name": "hash",
            "type": "bytes32"
          },
          {
            "indexed": false,
            "name": "value",
            "type": "uint256"
          },
          {
            "indexed": false,
            "name": "toea",
            "type": "uint256"
          },
          {
            "indexed": false,
            "name": "blockDeadline",
            "type": "uint256"
          }
        ],
        "name": "LogRemittanceAdded",
        "type": "event"
      },
      {
        "anonymous": false,
        "inputs": [
          {
            "indexed": true,
            "name": "sender",
            "type": "address"
          },
          {
            "indexed": false,
            "name": "hash",
            "type": "bytes32"
          },
          {
            "indexed": true,
            "name": "agentCode",
            "type": "bytes8"
          },
          {
            "indexed": true,
            "name": "receiverCode",
            "type": "bytes8"
          }
        ],
        "name": "LogRemittanceCollected",
        "type": "event"
      },
      {
        "anonymous": false,
        "inputs": [
          {
            "indexed": true,
            "name": "sender",
            "type": "address"
          },
          {
            "indexed": true,
            "name": "hash",
            "type": "bytes32"
          }
        ],
        "name": "LogRemittanceReturned",
        "type": "event"
      }
    ],
    "unlinked_binary": "0x606060405234610000576040516020806104f383398101604052515b5b60008054600160a060020a03191633600160a060020a03161790555b60018190555b505b6104a48061004f6000396000f300606060405236156100675763ffffffff60e060020a6000350416632c3a9a62811461006c5780635dcd1e911461008b5780637f1ce9eb146100bf578063893d20e8146100e35780639c922d2a1461010c578063a87563231461014c578063d63fb5e914610171575b610000565b34610000576100796101a3565b60408051918252519081900360200190f35b34610000576100ab600160c060020a0319600435811690602435166101a9565b604080519115158252519081900360200190f35b34610000576100ab600435610279565b604080519115158252519081900360200190f35b34610000576100f0610318565b60408051600160a060020a039092168252519081900360200190f35b346100005761011c600435610328565b60408051600160a060020a0390951685526020850193909352838301919091526060830152519081900360800190f35b6100ab60043560243560443561035b565b604080519115158252519081900360200190f35b3461000057610079600160c060020a03196004358116906024351661044d565b60408051918252519081900360200190f35b60015481565b60006000600060006101bb868661044d565b600081815260026020526040902060038101549194509250439010156101e057610000565b506001810180546000918290556040519091600160a060020a03331691839181818185876185025a03f192505050151561021957610000565b8154604080518581529051600160c060020a031980891693908a1692600160a060020a03909116917f4268796dd57392979ece78f0e764337f8b1190edd0a5a3a2a65f045ce83b3b199181900360200190a4600193505b50505092915050565b600081815260026020526040812060038101548290431161029957610000565b5060018101805460009182905582546040519192600160a060020a0390911691839181818185876185025a03f19250505015156102d557610000565b81546040518591600160a060020a0316907fbc98b22fb44db3f1b8f092b6c0e461f0754dc5246f5baf55ff3316a844a981dc90600090a3600192505b5050919050565b600054600160a060020a03165b90565b60026020819052600091825260409091208054600182015492820154600390920154600160a060020a0390911692919084565b6000838152600260205260408120600101548190118061037e5750816001544301105b1561038857610000565b6040805160808101825233600160a060020a039081168083523460208085018281528587018a815260608088018b815260008e81526002808752908b902099518a5473ffffffffffffffffffffffffffffffffffffffff191699169890981789559251600189015590519587019590955551600390950194909455845190815292830187905282840186905292518793927fe7698ce1d2703380c32b7f0aeb82133da7a549e0cbd0cae87c37f505e7ea7bc192908290030190a35060015b9392505050565b60408051600160c060020a031980851682528316600882015290519081900360100190205b929150505600a165627a7a72305820eaf8c5938b06207e9be8de64b4abbaecd2598a40a93ed6ee29af82dec3b3644f0029",
    "events": {
      "0x1d5efdabeea04a4c7c0d56564e0eee96a895b3c8d029e6271db5cd583970c550": {
        "anonymous": false,
        "inputs": [
          {
            "indexed": true,
            "name": "sender",
            "type": "address"
          },
          {
            "indexed": true,
            "name": "hash",
            "type": "bytes32"
          },
          {
            "indexed": false,
            "name": "value",
            "type": "uint256"
          },
          {
            "indexed": false,
            "name": "blockDeadline",
            "type": "uint256"
          }
        ],
        "name": "LogRemittanceAdded",
        "type": "event"
      },
      "0x4268796dd57392979ece78f0e764337f8b1190edd0a5a3a2a65f045ce83b3b19": {
        "anonymous": false,
        "inputs": [
          {
            "indexed": true,
            "name": "sender",
            "type": "address"
          },
          {
            "indexed": false,
            "name": "hash",
            "type": "bytes32"
          },
          {
            "indexed": true,
            "name": "agentCode",
            "type": "bytes8"
          },
          {
            "indexed": true,
            "name": "receiverCode",
            "type": "bytes8"
          }
        ],
        "name": "LogRemittanceCollected",
        "type": "event"
      },
      "0xbc98b22fb44db3f1b8f092b6c0e461f0754dc5246f5baf55ff3316a844a981dc": {
        "anonymous": false,
        "inputs": [
          {
            "indexed": true,
            "name": "sender",
            "type": "address"
          },
          {
            "indexed": true,
            "name": "hash",
            "type": "bytes32"
          }
        ],
        "name": "LogRemittanceReturned",
        "type": "event"
      },
      "0xe7698ce1d2703380c32b7f0aeb82133da7a549e0cbd0cae87c37f505e7ea7bc1": {
        "anonymous": false,
        "inputs": [
          {
            "indexed": true,
            "name": "sender",
            "type": "address"
          },
          {
            "indexed": true,
            "name": "hash",
            "type": "bytes32"
          },
          {
            "indexed": false,
            "name": "value",
            "type": "uint256"
          },
          {
            "indexed": false,
            "name": "toea",
            "type": "uint256"
          },
          {
            "indexed": false,
            "name": "blockDeadline",
            "type": "uint256"
          }
        ],
        "name": "LogRemittanceAdded",
        "type": "event"
      }
    },
    "updated_at": 1485087853501,
    "links": {},
    "address": "0x60f573825ae6172d04b434ed439b97d079387227"
  },
  "default": {
    "abi": [
      {
        "constant": true,
        "inputs": [],
        "name": "maxNumberOfBlocksInFuture",
        "outputs": [
          {
            "name": "",
            "type": "uint256"
          }
        ],
        "payable": false,
        "type": "function"
      },
      {
        "constant": false,
        "inputs": [
          {
            "name": "agentCode",
            "type": "bytes8"
          },
          {
            "name": "receiverCode",
            "type": "bytes8"
          }
        ],
        "name": "collect",
        "outputs": [
          {
            "name": "success",
            "type": "bool"
          }
        ],
        "payable": false,
        "type": "function"
      },
      {
        "constant": false,
        "inputs": [
          {
            "name": "hash",
            "type": "bytes32"
          }
        ],
        "name": "returnToSender",
        "outputs": [
          {
            "name": "success",
            "type": "bool"
          }
        ],
        "payable": false,
        "type": "function"
      },
      {
        "constant": true,
        "inputs": [],
        "name": "getOwner",
        "outputs": [
          {
            "name": "owner",
            "type": "address"
          }
        ],
        "payable": false,
        "type": "function"
      },
      {
        "constant": true,
        "inputs": [
          {
            "name": "",
            "type": "bytes32"
          }
        ],
        "name": "remittances",
        "outputs": [
          {
            "name": "sender",
            "type": "address"
          },
          {
            "name": "amount",
            "type": "uint256"
          },
          {
            "name": "toea",
            "type": "uint256"
          },
          {
            "name": "blockDeadline",
            "type": "uint256"
          }
        ],
        "payable": false,
        "type": "function"
      },
      {
        "constant": false,
        "inputs": [
          {
            "name": "hash",
            "type": "bytes32"
          },
          {
            "name": "toea",
            "type": "uint256"
          },
          {
            "name": "blockDeadline",
            "type": "uint256"
          }
        ],
        "name": "sendTo",
        "outputs": [
          {
            "name": "success",
            "type": "bool"
          }
        ],
        "payable": true,
        "type": "function"
      },
      {
        "constant": true,
        "inputs": [
          {
            "name": "agentCode",
            "type": "bytes8"
          },
          {
            "name": "receiverCode",
            "type": "bytes8"
          }
        ],
        "name": "anonymise",
        "outputs": [
          {
            "name": "hash",
            "type": "bytes32"
          }
        ],
        "payable": false,
        "type": "function"
      },
      {
        "inputs": [
          {
            "name": "_maxNumberOfBlocksInFuture",
            "type": "uint256"
          }
        ],
        "payable": false,
        "type": "constructor"
      },
      {
        "anonymous": false,
        "inputs": [
          {
            "indexed": true,
            "name": "sender",
            "type": "address"
          },
          {
            "indexed": true,
            "name": "hash",
            "type": "bytes32"
          },
          {
            "indexed": false,
            "name": "value",
            "type": "uint256"
          },
          {
            "indexed": false,
            "name": "toea",
            "type": "uint256"
          },
          {
            "indexed": false,
            "name": "blockDeadline",
            "type": "uint256"
          }
        ],
        "name": "LogRemittanceAdded",
        "type": "event"
      },
      {
        "anonymous": false,
        "inputs": [
          {
            "indexed": true,
            "name": "sender",
            "type": "address"
          },
          {
            "indexed": false,
            "name": "hash",
            "type": "bytes32"
          },
          {
            "indexed": true,
            "name": "agentCode",
            "type": "bytes8"
          },
          {
            "indexed": true,
            "name": "receiverCode",
            "type": "bytes8"
          }
        ],
        "name": "LogRemittanceCollected",
        "type": "event"
      },
      {
        "anonymous": false,
        "inputs": [
          {
            "indexed": true,
            "name": "sender",
            "type": "address"
          },
          {
            "indexed": true,
            "name": "hash",
            "type": "bytes32"
          }
        ],
        "name": "LogRemittanceReturned",
        "type": "event"
      }
    ],
    "unlinked_binary": "0x606060405234610000576040516020806104f383398101604052515b5b60008054600160a060020a03191633600160a060020a03161790555b60018190555b505b6104a48061004f6000396000f300606060405236156100675763ffffffff60e060020a6000350416632c3a9a62811461006c5780635dcd1e911461008b5780637f1ce9eb146100bf578063893d20e8146100e35780639c922d2a1461010c578063a87563231461014c578063d63fb5e914610171575b610000565b34610000576100796101a3565b60408051918252519081900360200190f35b34610000576100ab600160c060020a0319600435811690602435166101a9565b604080519115158252519081900360200190f35b34610000576100ab600435610279565b604080519115158252519081900360200190f35b34610000576100f0610318565b60408051600160a060020a039092168252519081900360200190f35b346100005761011c600435610328565b60408051600160a060020a0390951685526020850193909352838301919091526060830152519081900360800190f35b6100ab60043560243560443561035b565b604080519115158252519081900360200190f35b3461000057610079600160c060020a03196004358116906024351661044d565b60408051918252519081900360200190f35b60015481565b60006000600060006101bb868661044d565b600081815260026020526040902060038101549194509250439010156101e057610000565b506001810180546000918290556040519091600160a060020a03331691839181818185876185025a03f192505050151561021957610000565b8154604080518581529051600160c060020a031980891693908a1692600160a060020a03909116917f4268796dd57392979ece78f0e764337f8b1190edd0a5a3a2a65f045ce83b3b199181900360200190a4600193505b50505092915050565b600081815260026020526040812060038101548290431161029957610000565b5060018101805460009182905582546040519192600160a060020a0390911691839181818185876185025a03f19250505015156102d557610000565b81546040518591600160a060020a0316907fbc98b22fb44db3f1b8f092b6c0e461f0754dc5246f5baf55ff3316a844a981dc90600090a3600192505b5050919050565b600054600160a060020a03165b90565b60026020819052600091825260409091208054600182015492820154600390920154600160a060020a0390911692919084565b6000838152600260205260408120600101548190118061037e5750816001544301105b1561038857610000565b6040805160808101825233600160a060020a039081168083523460208085018281528587018a815260608088018b815260008e81526002808752908b902099518a5473ffffffffffffffffffffffffffffffffffffffff191699169890981789559251600189015590519587019590955551600390950194909455845190815292830187905282840186905292518793927fe7698ce1d2703380c32b7f0aeb82133da7a549e0cbd0cae87c37f505e7ea7bc192908290030190a35060015b9392505050565b60408051600160c060020a031980851682528316600882015290519081900360100190205b929150505600a165627a7a72305820eaf8c5938b06207e9be8de64b4abbaecd2598a40a93ed6ee29af82dec3b3644f0029",
    "events": {
      "0x1d5efdabeea04a4c7c0d56564e0eee96a895b3c8d029e6271db5cd583970c550": {
        "anonymous": false,
        "inputs": [
          {
            "indexed": true,
            "name": "sender",
            "type": "address"
          },
          {
            "indexed": true,
            "name": "hash",
            "type": "bytes32"
          },
          {
            "indexed": false,
            "name": "value",
            "type": "uint256"
          },
          {
            "indexed": false,
            "name": "blockDeadline",
            "type": "uint256"
          }
        ],
        "name": "LogRemittanceAdded",
        "type": "event"
      },
      "0x4268796dd57392979ece78f0e764337f8b1190edd0a5a3a2a65f045ce83b3b19": {
        "anonymous": false,
        "inputs": [
          {
            "indexed": true,
            "name": "sender",
            "type": "address"
          },
          {
            "indexed": false,
            "name": "hash",
            "type": "bytes32"
          },
          {
            "indexed": true,
            "name": "agentCode",
            "type": "bytes8"
          },
          {
            "indexed": true,
            "name": "receiverCode",
            "type": "bytes8"
          }
        ],
        "name": "LogRemittanceCollected",
        "type": "event"
      },
      "0xbc98b22fb44db3f1b8f092b6c0e461f0754dc5246f5baf55ff3316a844a981dc": {
        "anonymous": false,
        "inputs": [
          {
            "indexed": true,
            "name": "sender",
            "type": "address"
          },
          {
            "indexed": true,
            "name": "hash",
            "type": "bytes32"
          }
        ],
        "name": "LogRemittanceReturned",
        "type": "event"
      },
      "0xe7698ce1d2703380c32b7f0aeb82133da7a549e0cbd0cae87c37f505e7ea7bc1": {
        "anonymous": false,
        "inputs": [
          {
            "indexed": true,
            "name": "sender",
            "type": "address"
          },
          {
            "indexed": true,
            "name": "hash",
            "type": "bytes32"
          },
          {
            "indexed": false,
            "name": "value",
            "type": "uint256"
          },
          {
            "indexed": false,
            "name": "toea",
            "type": "uint256"
          },
          {
            "indexed": false,
            "name": "blockDeadline",
            "type": "uint256"
          }
        ],
        "name": "LogRemittanceAdded",
        "type": "event"
      }
    },
    "updated_at": 1485087590413,
    "links": {},
    "address": "0x9bd60afce4c74a25aa0ffe2980228a0aad5ead4e"
  }
};

  Contract.checkNetwork = function(callback) {
    var self = this;

    if (this.network_id != null) {
      return callback();
    }

    this.web3.version.network(function(err, result) {
      if (err) return callback(err);

      var network_id = result.toString();

      // If we have the main network,
      if (network_id == "1") {
        var possible_ids = ["1", "live", "default"];

        for (var i = 0; i < possible_ids.length; i++) {
          var id = possible_ids[i];
          if (Contract.all_networks[id] != null) {
            network_id = id;
            break;
          }
        }
      }

      if (self.all_networks[network_id] == null) {
        return callback(new Error(self.name + " error: Can't find artifacts for network id '" + network_id + "'"));
      }

      self.setNetwork(network_id);
      callback();
    })
  };

  Contract.setNetwork = function(network_id) {
    var network = this.all_networks[network_id] || {};

    this.abi             = this.prototype.abi             = network.abi;
    this.unlinked_binary = this.prototype.unlinked_binary = network.unlinked_binary;
    this.address         = this.prototype.address         = network.address;
    this.updated_at      = this.prototype.updated_at      = network.updated_at;
    this.links           = this.prototype.links           = network.links || {};
    this.events          = this.prototype.events          = network.events || {};

    this.network_id = network_id;
  };

  Contract.networks = function() {
    return Object.keys(this.all_networks);
  };

  Contract.link = function(name, address) {
    if (typeof name == "function") {
      var contract = name;

      if (contract.address == null) {
        throw new Error("Cannot link contract without an address.");
      }

      Contract.link(contract.contract_name, contract.address);

      // Merge events so this contract knows about library's events
      Object.keys(contract.events).forEach(function(topic) {
        Contract.events[topic] = contract.events[topic];
      });

      return;
    }

    if (typeof name == "object") {
      var obj = name;
      Object.keys(obj).forEach(function(name) {
        var a = obj[name];
        Contract.link(name, a);
      });
      return;
    }

    Contract.links[name] = address;
  };

  Contract.contract_name   = Contract.prototype.contract_name   = "Remittances";
  Contract.generated_with  = Contract.prototype.generated_with  = "3.2.0";

  // Allow people to opt-in to breaking changes now.
  Contract.next_gen = false;

  var properties = {
    binary: function() {
      var binary = Contract.unlinked_binary;

      Object.keys(Contract.links).forEach(function(library_name) {
        var library_address = Contract.links[library_name];
        var regex = new RegExp("__" + library_name + "_*", "g");

        binary = binary.replace(regex, library_address.replace("0x", ""));
      });

      return binary;
    }
  };

  Object.keys(properties).forEach(function(key) {
    var getter = properties[key];

    var definition = {};
    definition.enumerable = true;
    definition.configurable = false;
    definition.get = getter;

    Object.defineProperty(Contract, key, definition);
    Object.defineProperty(Contract.prototype, key, definition);
  });

  bootstrap(Contract);

  if (typeof module != "undefined" && typeof module.exports != "undefined") {
    module.exports = Contract;
  } else {
    // There will only be one version of this contract in the browser,
    // and we can use that.
    window.Remittances = Contract;
  }
})();
