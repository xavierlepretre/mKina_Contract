module.exports = {
    build: {
        "index.html": "index.html",
        "app.js": [
            "javascripts/app.js"
        ],
        "angular.js": [
            "javascripts/_vendor/angular.js"
        ],
        "remittance.js": [
            "javascripts/remittanceApp.js",
            "javascripts/remittanceListController.js",
            "javascripts/utils.js"
        ],
        "app.css": [
            "stylesheets/app.css"
            // "stylesheets/_vendor/jquery-ui.css"
        ],
        "images/": "images/"
    },
    rpc: {
        host: "localhost",
        port: 8545
    },
    networks: {
        "ropsten": {
            network_id: 3,
            gas: 3000000
        }
    }
};
