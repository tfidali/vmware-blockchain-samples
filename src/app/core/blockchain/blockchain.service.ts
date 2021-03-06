
/*
 * Copyright 2019 VMware, all rights reserved.
 * This software is released under MIT license.
 * The full license information can be found in LICENSE in the root directory of this project.
 */

import { Injectable } from '@angular/core';
import { from as fromPromise, Subject } from 'rxjs';
import { mergeMap } from 'rxjs/operators';

import Web3 from 'web3';
import * as HttpHeaderProvider from 'httpheaderprovider';

import { environment } from '../../../environments/environment';
import { AuthService } from '../../auth/auth.service';

import * as Order from '../../../assets/contracts/OrderV1.json';
import * as Orders from '../../../assets/contracts/OrdersProxy.json';
import * as OrdersV1 from '../../../assets/contracts/OrdersV1.json';
import { sequentialArray } from '../../shared/utils';
import {
  Order as OrderModel,
  OrderHistory,
  OrdersResponse,
  OrderStatus
} from '../order/order';


@Injectable({
  providedIn: 'root'
})
export class BlockchainService {
  ordersAddress: any = Orders.networks[environment.network].address;
  ordersABI: any = OrdersV1.abi;
  orderABI: any = Order.abi;
  address: string = environment.path;
  web3: Web3;
  ordersContract: any;
  from: string;
  accounts: string[];
  sendDefaults = { from: undefined, 'gas': '4400000' };

  private newOrderSource = new Subject<any>();
  public newOrder = this.newOrderSource.asObservable();

  private updatedOrderSource = new Subject<OrderModel>();
  public updatedOrder = this.updatedOrderSource.asObservable();

  public readonly items = ['Apples', 'Bananas', 'Oranges'];
  private servicePromise: Promise<any>;

  constructor(private authService: AuthService) {
    if (environment.blockchainType === 'vmware') {
      this.web3 = this.vmwareBlockchain();
    } else {
      this.web3 = this.ganache();
    }

    this.servicePromise = this.getAccounts();
  }

  vmwareBlockchain(): Web3 {
    return new Web3(this.authService.getVmwareBlockChainProvider());
  }

  ganache(): Web3 {
    return new Web3(new Web3.providers.HttpProvider(this.address));
  }

  approveOrder(order: OrderModel): Promise<any> {
    return this.sendOrder(order, 'approve');
  }

  confirmDeliveryOrder(order: OrderModel): Promise<any> {
    return this.sendOrder(order, 'confirmDelivery');
  }

  createOrder(productType: string, quantity: number): Promise<any> {
    return fromPromise(this.servicePromise).pipe(mergeMap(() => {
      return new Promise((resolve, reject) => {
        return this.ordersContract.create(
          this.web3.fromUtf8(productType),
          quantity,
          this.sendDefaults,
          this.callbackToResolve(resolve, reject)
        );
      }).then((address) => {
        this.newOrderSource.next();
        return address;
      });
    })).toPromise();
  }

  deliveredOrder(order: OrderModel): Promise<any> {
    return this.sendOrder(order, 'delivered');
  }

  getHistory(order: OrderModel): Promise<any> {
    return this.getHistoryLength(order).then((historyLength) => {
      if (historyLength > 0) {
        const historyIndices = sequentialArray(0, historyLength);
        const historyPromises = historyIndices.map(i => this.getHistoryRecord(order, i));
        return Promise.all(historyPromises);
      } else {
        return Promise.resolve([]);
      }
    });
  }

  getHistoryLength(order: OrderModel): Promise<any> {
    return new Promise((resolve, reject) => {
      return order.contract.getHistoryLength(this.callbackToResolve(resolve, reject));
    });
  }

  getHistoryRecord(order: OrderModel, index: number): Promise<OrderHistory> {
    return new Promise((resolve, reject) => {
      return order.contract.history(index, this.callbackToResolve(resolve, reject));
    }).then((record) => {
      return {
        action: this.web3.toUtf8(record[1]),
        owner: record[0],
        transactionId: '0x4534534534abec533' // TODO - where to get this?
      } as OrderHistory;
    });
  }

  getOrder(index: number): Promise<OrderModel> {
    return fromPromise(this.servicePromise).pipe(mergeMap(() => {
      return this.order(index).then((address) => {
        return this.getOrderByAddress(address);
      });
    })).toPromise();
  }

  getOrderByAddress(address: string): Promise<OrderModel> {
    const contract = this.web3.eth.contract(this.orderABI).at(address);
    return this.buildOrder(contract, address).then(order => {
      return order;
    });
  }

  order(index: number): Promise<any> {
    return this.callWithPromise('orders', index);
  }

  orders(startIndex: number = 0, pageSize: number = 20): Promise<OrdersResponse> {
    return this.orderCount().then((total) => {
      if (total > 0) {
        const maxIndex = Math.min(total as number, startIndex + pageSize);
        const indices = sequentialArray(startIndex, maxIndex - startIndex);
        const orderPromises = indices.map(i => this.getOrder(i));
        return Promise.all(orderPromises).then(orders => {
          return {
            orders: orders,
            total: total
          } as OrdersResponse;
        });
      } else {
        return {
          orders: [],
          total: total
        } as OrdersResponse;
      }
    });
  }

  orderCount(): Promise<any> {
    return this.callWithPromise('getAmount');
  }

  receivedAndInTransitOrder(order: OrderModel): Promise<any> {
    return this.sendOrder(order, 'receivedAndInTransit');
  }

  revokeOrder(order: OrderModel): Promise<any> {
    return this.sendOrder(order, 'revoke');
  }

  storeAuditDocumentOrder(order: OrderModel): Promise<any> {
    return this.sendOrder(order, 'storeAuditDocument');
  }

  validatedOrder(order: OrderModel): Promise<any> {
    return this.sendOrder(order, 'validated');
  }

  verifyInTransitOrder(order: OrderModel): Promise<any> {
    return this.sendOrder(order, 'verifyInTransit');
  }

  warehouseReceivedOrder(order: OrderModel): Promise<any> {
    return this.sendOrder(order, 'warehouseReceivedOrder');
  }

  warehouseReleasedOrder(order: OrderModel): Promise<any> {
    return this.sendOrder(order, 'warehouseReleasedOrder');
  }

  private buildOrder(contract, address: string): Promise<OrderModel> {
    const order = new OrderModel();
    order.id = address;
    order.contract = contract;
    const loadHistory = this.getHistory(order).then((history) => {
      order.history = history;
    });
    const loadMeta = new Promise((resolve, reject) => {
      return contract.meta(this.callbackToResolve(resolve, reject));
    }).then(meta => {
      order.amount = meta[1];
      order.product = this.web3.toUtf8(meta[0]);
      return order;
    });
    const loadStatus = new Promise((resolve, reject) => {
      return contract.state(this.callbackToResolve(resolve, reject));
    }).then(status => {
      order.status = parseInt(status as string, 10);
      order.statusLabel = OrderStatus[status as string];
    });
    return Promise.all([loadHistory, loadMeta, loadStatus]).then(() => {
      return order;
    });
  }

  private callWithPromise(methodName: string, ...args: any[]): Promise<any> {
    return fromPromise(this.servicePromise).pipe(mergeMap(() => {
      return new Promise((resolve, reject) => {
        if (args.length === 0) {
          return this.ordersContract[methodName](this.callbackToResolve(resolve, reject));
        } else {
          return this.ordersContract[methodName](...args, this.callbackToResolve(resolve, reject));
        }
      });
    })).toPromise();
  }

  private getAccounts(): Promise<any> {
    return new Promise((resolve, reject) => {
      return this.web3.eth.getAccounts(this.callbackToResolve(resolve, reject));
    }).then(accounts => {
      // @ts-ignore
      this.accounts = accounts;
      this.from = this.accounts[1];
      this.sendDefaults.from = this.from;
      this.web3.eth.defaultAccount = this.from;
      this.ordersContract = this.web3.eth.contract(this.ordersABI).at(this.ordersAddress);
    });

  }

  private sendOrder(order, methodName, ...args: any[]): Promise<any> {
    // setOwners is temporary until we have a more robust approach to roles
    return new Promise((resolve, reject) => {
      return this.setOwners(order, this.from).then(() => {
        return order.contract[methodName](
          ...args, this.sendDefaults, this.callbackToResolve(resolve, reject)
        );
      });
    }).then((resp) => {
      return this.getOrderByAddress(order.id).then((updatedOrder) => {
        this.updatedOrderSource.next(updatedOrder);
        return updatedOrder;
      });
    }).catch(err => console.error(err));
  }

  private setOwners(order, userAddress: string): Promise<any> {
    return new Promise((resolve, reject) => {
      return order.contract.setOwners(
        ...(new Array(5).fill(userAddress)),
        this.sendDefaults,
        this.callbackToResolve(resolve, reject));
    });
  }

  private callbackToResolve(resolve, reject) {
    return function(error, value) {
      if (error) {
        reject(error);
      } else {
        resolve(value);
      }
    };
  }

}
