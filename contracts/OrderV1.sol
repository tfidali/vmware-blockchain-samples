/*
 * Copyright 2019 VMware, all rights reserved.
 * This software is released under MIT license.
 * The full license information can be found in LICENSE in the root directory of this project.
 */

pragma solidity >=0.4.21 <0.6.0;

import "./OrderAccessControl.sol";

/**
 * @title OrderV1
 */
contract OrderV1 is OrderAccessControl {

  // Order meta data
  struct Meta {
    bytes32 product;
    uint amount;
    bool revoked;
  }

  // Record
  struct Record {
    address who;
    bytes32 action;
    uint32 when;
  }

  // Location of order
  struct Location {
    bytes32 latitude;
    bytes32 longitude;
    address who;
  }

  enum State {
    Ordered,
    Approved,
    Audited,
    AtWarehouse,
    WarehouseReleased,
    InTransit,
    Delivered,
    Revoked
  }

  enum SubState {
    None, Pending, InTransit
  }

  Meta public meta;
  Record[] public history;
  Location[] public locationHistory;
  State public state;
  SubState public subState;

  modifier inState(State _state) {
      require(
          state == _state,
          "Invalid state."
      );
      _;
  }

  constructor(
    bytes32 product, uint amount, address creator
  ) public {
    contractCreator = creator;
    meta.product = product;
    meta.amount = amount;
    meta.revoked = false;

    state = State.Ordered;
    subState = SubState.None;
  }

  //
  // Order Form
  //

  /**
   * @dev Farmer must approve order created by the Supermarket
   */
  function approve()
    public
    onlyFarmer
    inState(State.Ordered)
  {
    addRecord(bytes32("Approved"));
    state = State.Approved;

  }

  /**
   * @dev Auditor will validate if order is organic
   */
  function validated()
    public
    onlyAuditor
    inState(State.Approved)
  {
    addRecord(bytes32("Audited"));
    state = State.Audited;
  }

  /**
   * @dev Auditor will store the audit document
   */
  function storeAuditDocument()
    public
    onlyAuditor
    inState(State.Audited)
  {
    addRecord(bytes32("Stored document"));
  }

  /**
   * @dev Warehouse will store the order shipment
   */
  function warehouseReceivedOrder()
    public
    onlyWarehouse
    inState(State.Audited)
  {
    state = State.AtWarehouse;
    addRecord(bytes32("Received"));
  }

  /**
   * @dev Warehouse releases order to distributor
   */
  function warehouseReleasedOrder()
    public
    onlyWarehouse
    inState(State.AtWarehouse)
  {
    state = State.WarehouseReleased;
    addRecord(bytes32("Released"));
  }

  /**
   * @dev Distributor pickups order at warehouse and puts order in transit
   */
  function receivedAndInTransit()
    public
    onlyDistributor
    inState(State.WarehouseReleased)
  {
    addRecord(bytes32("In Transit"));
    state = State.InTransit;
  }

  /**
   * @dev SuperMarket confirms delivery of order
   */
  function confirmDelivery()
    public
    onlySupermarket
    inState(State.InTransit)
  {
    addRecord(bytes32("Confirmed Delivery"));
    state = State.Delivered;
  }

  /**
   * @dev Farmer or auditor revokes order due to compliance or issues with order
   */
  function revoke()
    public
    onlyFarmerOrAuditor
  {
    state = State.Revoked;
    meta.revoked = true;
  }

  //
  // Storage
  //

  /**
   * @dev Record history
   * @param action The action of the order
   */
  function addRecord(bytes32 action) internal {
    history.push(Record({
        who: msg.sender,
        action: action,
        when: uint32(now)
      }));
  }

  /**
   * @dev Get order history length
   */
  function getHistoryLength()
    public
    view
    returns(uint)
  {
    return (history.length);
  }


  /**
   * @dev Contract owners are allowed to record the contract location
   * @param latitude The latitudinal coordinate of the order
   * @param longitude The longitudinal coordinate of the order
   */
  function updateLocation(
    bytes32 latitude, bytes32 longitude
  )
    public
    onlyContractOwners
  {
    locationHistory.push(Location({
        latitude: latitude,
        longitude: longitude,
        who: msg.sender
      }));
  }

  /**
   * @dev Get location history length
   */
  function getLocationLength()
    public
    view
    returns(uint)
  {
    return (locationHistory.length);
  }

}
