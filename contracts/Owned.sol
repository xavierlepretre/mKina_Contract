pragma solidity ^0.4.2;

contract Owned {
    address private _owner;

    function Owned() {
        _owner = msg.sender;
    }

    function getOwner() constant returns (address owner) {
        return _owner;
    }
}