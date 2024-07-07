const User = require("../models/UserModel.js");
const Household = require("../models/HouseholdModel.js");
const BoughtItem = require("../models/BoughtItemModel.js");
const { addBoughtItemToHistory } = require("../utils/historyUtils.js");

const updateDebts = async (req, res) => {
  try {
    const { id } = req.params;
    const users = await User.find({ household_id: id });
    const household = await Household.findById(id).populate('members');
    const debtors = users.filter((user) => user.balance < 0);
    const creditors = users.filter((user) => user.balance > 0);

    const debts = [];
    for (let debtor of debtors) {
      for (let creditor of creditors) {
        const amount = Math.min(-debtor.balance, creditor.balance);
        if (amount > 0) {
          const debt = {
            householdMember1: debtor._id,
            householdMember2: creditor._id,
            moneyToPay: amount,
            moneyToRecive: amount,
            payed: false,
            payedConfirmation: false,
          };
          debts.push(debt);
        }
      }
    }

    household.debts = debts;
    await household.save();

    res.status(200).json(household.debts);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

const markDebtAsPaid = async (req, res) => {
  try {
    const { householdId, debtId } = req.params;
    const household = await Household.findById(householdId);
    const debt = household.debts.id(debtId);

    if (!debt) {
      return res.status(404).json({ message: 'Debt not found' });
    }

    debt.payed = true;
    await household.save();

    res.status(200).json({ message: 'Debt marked as paid', debt });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

const confirmDebtPayment = async (req, res) => {
  try {
    const { householdId, debtId } = req.params;
    const household = await Household.findById(householdId);
    const debt = household.debts.id(debtId);

    if (!debt) {
      return res.status(404).json({ message: 'Debt not found' });
    }

    if (debt.payed) {
      debt.payedConfirmation = true;

      const debtor = await User.findById(debt.householdMember1);
      const creditor = await User.findById(debt.householdMember2);

      debtor.balance += debt.moneyToPay;
      creditor.balance -= debt.moneyToRecive;

      debt.moneyToPay = 0;
      debt.moneyToRecive = 0;

      await Promise.all([debtor.save(), creditor.save(), household.save()]);

      res.status(200).json({ message: 'Debt payment confirmed', debt });
    } else {
      res.status(400).json({ message: 'Debt has not been marked as paid' });
    }
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

const updateBalances = async (householdId) => {
  try {
    const household = await Household.findById(householdId).populate('members');
    const members = household.members;

    const balanceMap = {};
    const payments = {};

    members.forEach(member => {
      balanceMap[member._id] = 0;
      payments[member._id] = 0;
    });

    const boughtItems = await BoughtItem.find({ household_id: householdId }).populate('buyer', 'username');
    const totalCost = boughtItems.reduce((acc, item) => acc + item.cost, 0);
    const sharePerMember = totalCost / members.length;

    boughtItems.forEach(item => {
      payments[item.buyer._id] += item.cost;
    });

    members.forEach(member => {
      balanceMap[member._id] = payments[member._id] - sharePerMember;
    });

    let debtors = [];
    let creditors = [];

    members.forEach(member => {
      if (balanceMap[member._id] < 0) {
        debtors.push({ member: member._id, amount: balanceMap[member._id] });
      } else if (balanceMap[member._id] > 0) {
        creditors.push({ member: member._id, amount: balanceMap[member._id] });
      }
    });

    debtors.sort((a, b) => a.amount - b.amount);
    creditors.sort((a, b) => b.amount - a.amount);

    const debtsMap = {};

    members.forEach(member => {
      debtsMap[member._id] = {};
    });

    while (debtors.length && creditors.length) {
      const debtor = debtors[0];
      const creditor = creditors[0];
      const amount = Math.min(-debtor.amount, creditor.amount);

      debtsMap[debtor.member][creditor.member] = amount;
      debtor.amount += amount;
      creditor.amount -= amount;

      if (debtor.amount === 0) {
        debtors.shift();
      }
      if (creditor.amount === 0) {
        creditors.shift();
      }
    }

    await Promise.all(members.map(async member => {
      member.balance = balanceMap[member._id];
      member.debts = debtsMap[member._id];
      await member.save();
    }));

    console.log('Final debtsMap:');
    console.log(debtsMap);
  } catch (error) {
    console.error('Error updating balances:', error);
  }
};

const getBalances = async (req, res) => {
  try {
    const householdId = req.user.household_id;
    const users = await User.find({ household_id: householdId }, 'username balance debts');
    res.json(users);
  } catch (error) {
    console.error('Error fetching balances:', error);
    res.status(500).json({ message: 'Server error' });
  }
};

const createBoughtItem = async (req, res) => {
  const { name, cost, buyer } = req.body;
  const householdId = req.user.household_id;

  try {
    const newItem = new BoughtItem({
      name,
      cost,
      buyer,
      household_id: householdId
    });
    await newItem.save();
    await addBoughtItemToHistory(householdId, newItem);

    await updateBalances(householdId);

    res.status(201).json(newItem);
  } catch (error) {
    console.error('Error creating bought item:', error);
    res.status(500).json({ message: 'Server error' });
  }
};

module.exports = {
  updateDebts,
  markDebtAsPaid,
  confirmDebtPayment,
  getBalances,
  createBoughtItem,
  updateBalances,
};

// //FRIDAY VERSION: 

// const updateBalances = async (householdId) => {
//   try {
//     const household = await Household.findById(householdId).populate('members');
//     const members = household.members;

//     // Initialize balance map
//     const balanceMap = {};
//     const payments = {};

//     members.forEach(member => {
//       balanceMap[member._id] = 0; // Initialize each member's balance
//       payments[member._id] = 0; // Initialize each member's payments
//     });

//     // Fetch all bought items for the household
//     const boughtItems = await BoughtItem.find({ household_id: householdId }).populate('buyer', 'username');

//     // Calculate total cost
//     const totalCost = boughtItems.reduce((acc, item) => acc + item.cost, 0);

//     // Calculate each member's share of the total cost
//     const memberCount = members.length;
//     const sharePerMember = totalCost / memberCount;

//     // Calculate how much each member has paid
//     boughtItems.forEach(item => {
//       payments[item.buyer._id] += item.cost;
//     });

//     // Calculate balance for each member
//     members.forEach(member => {
//       balanceMap[member._id] = payments[member._id] - sharePerMember;
//     });

//     // Calculate debts based on balances
//     let debtors = [];
//     let creditors = [];

//     members.forEach(member => {
//       if (balanceMap[member._id] < 0) {
//         debtors.push({ member: member._id, amount: balanceMap[member._id] });
//       } else if (balanceMap[member._id] > 0) {
//         creditors.push({ member: member._id, amount: balanceMap[member._id] });
//       }
//     });

//     debtors.sort((a, b) => a.amount - b.amount);
//     creditors.sort((a, b) => b.amount - a.amount);

//     const debtsMap = {};

//     members.forEach(member => {
//       debtsMap[member._id] = {};
//     });

//     while (debtors.length && creditors.length) {
//       const debtor = debtors[0];
//       const creditor = creditors[0];
//       const amount = Math.min(-debtor.amount, creditor.amount);

//       debtsMap[debtor.member][creditor.member] = amount;
//       debtor.amount += amount;
//       creditor.amount -= amount;

//       if (debtor.amount === 0) {
//         debtors.shift();
//       }
//       if (creditor.amount === 0) {
//         creditors.shift();
//       }
//     }

//     // Update each member's balance and debts
//     await Promise.all(members.map(async member => {
//       member.balance = balanceMap[member._id];
//       member.debts = debtsMap[member._id];
//       await member.save();
//     }));

//     console.log('Final debtsMap:');
//     console.log(debtsMap);

//   } catch (error) {
//     console.error('Error updating balances:', error);
//   }
// };

// const getBalances = async (req, res) => {
//   try {
//     const householdId = req.user.household_id;
//     const users = await User.find({ household_id: householdId }, 'username balance debts');
//     res.json(users);
//   } catch (error) {
//     console.error('Error fetching balances:', error);
//     res.status(500).json({ message: 'Server error' });
//   }
// };

// const createBoughtItem = async (req, res) => {
//   const { name, cost, buyer } = req.body;
//   const householdId = req.user.household_id;

//   try {
//     const newItem = new BoughtItem({
//       name,
//       cost,
//       buyer,
//       household_id: householdId
//     });
//     console.log(newItem);
//     await newItem.save();
//     await addBoughtItemToHistory(householdId, newItem);

//     // Update balances after adding the new bought item
//     await updateBalances(householdId);

//     res.status(201).json(newItem);
//   } catch (error) {
//     console.error('Error creating bought item:', error);
//     res.status(500).json({ message: 'Server error' });
//   }
// };


// module.exports = { updateBalances, getBalances, createBoughtItem };


//MY THURSDAY ATTEMPT
// // Controller to mark debt as paid
// const markDebtAsPaid = async (req, res) => {
//   const { householdId, debtorId, creditorId } = req.body;

//   try {
//     const household = await Household.findById(householdId);
//     const debt = household.debts.find(
//       (d) => d.householdMember1.equals(debtorId) && d.householdMember2.equals(creditorId)
//     );

//     if (debt) {
//       debt.paid = true;
//       await household.save();
//       res.json({ message: 'Debt marked as paid' });
//     } else {
//       res.status(404).json({ message: 'Debt not found' });
//     }
//   } catch (error) {
//     console.error('Error marking debt as paid:', error);
//     res.status(500).json({ message: 'Server error' });
//   }
// };

// // Controller to confirm debt payment
// const confirmDebtPayment = async (req, res) => {
//   const { householdId, debtorId, creditorId } = req.body;

//   try {
//     const household = await Household.findById(householdId);
//     const debt = household.debts.find(
//       (d) => d.householdMember1.equals(debtorId) && d.householdMember2.equals(creditorId)
//     );

//     if (debt) {
//       debt.paidConfirmation = true;

//       if (debt.paid && debt.paidConfirmation) {
//         debt.moneyToPay = 0;
//         debt.moneyToReceive = 0;
//       }

//       await household.save();
//       res.json({ message: 'Debt payment confirmed' });
//     } else {
//       res.status(404).json({ message: 'Debt not found' });
//     }
//   } catch (error) {
//     console.error('Error confirming debt payment:', error);
//     res.status(500).json({ message: 'Server error' });
//   }
// };



// const updateBalances = async (householdId) => {
//   try {
//     const household = await Household.findById(householdId).populate('members');
//     const members = household.members;

//     // Initialize balance map
//     const balanceMap = {};
//     const payments = {};

//     members.forEach(member => {
//       balanceMap[member._id] = 0; // Initialize each member's balance
//       payments[member._id] = 0; // Initialize each member's payments
//     });

//     // Fetch all bought items for the household
//     const boughtItems = await BoughtItem.find({ household_id: householdId }).populate('buyer', 'username');

//     // Calculate total cost
//     const totalCost = boughtItems.reduce((acc, item) => acc + item.cost, 0);

//     // Calculate each member's share of the total cost
//     const memberCount = members.length;
//     const sharePerMember = totalCost / memberCount;

//     // Calculate how much each member has paid
//     boughtItems.forEach(item => {
//       payments[item.buyer._id] += item.cost;
//     });

//     // Calculate balance for each member
//     members.forEach(member => {
//       balanceMap[member._id] = payments[member._id] - sharePerMember;
//     });

//     // Calculate debts based on balances
//     let debtors = [];
//     let creditors = [];

//     members.forEach(member => {
//       if (balanceMap[member._id] < 0) {
//         debtors.push({ member: member._id, amount: balanceMap[member._id] });
//       } else if (balanceMap[member._id] > 0) {
//         creditors.push({ member: member._id, amount: balanceMap[member._id] });
//       }
//     });

//     debtors.sort((a, b) => a.amount - b.amount);
//     creditors.sort((a, b) => b.amount - a.amount);

//     const debtsMap = {};

//     members.forEach(member => {
//       debtsMap[member._id] = {};
//     });

//     while (debtors.length && creditors.length) {
//       const debtor = debtors[0];
//       const creditor = creditors[0];
//       const amount = Math.min(-debtor.amount, creditor.amount);

//       debtsMap[debtor.member][creditor.member] = amount;
//       debtor.amount += amount;
//       creditor.amount -= amount;

//       if (debtor.amount === 0) {
//         debtors.shift();
//       }
//       if (creditor.amount === 0) {
//         creditors.shift();
//       }
//     }

//     // Update each member's balance and debts
//     await Promise.all(members.map(async member => {
//       member.balance = balanceMap[member._id];
//       member.debts = debtsMap[member._id];
//       await member.save();
//     }));

//     console.log('Final debtsMap:');
//     console.log(debtsMap);

//   } catch (error) {
//     console.error('Error updating balances:', error);
//   }
// };

// const getBalances = async (req, res) => {
//   try {
//     const householdId = req.user.household_id;
//     const users = await User.find({ household_id: householdId }, 'username balance debts');
//     res.json(users);
//   } catch (error) {
//     console.error('Error fetching balances:', error);
//     res.status(500).json({ message: 'Server error' });
//   }
// };

// const createBoughtItem = async (req, res) => {
//   const { name, cost, buyer } = req.body;
//   const householdId = req.user.household_id;





//   try {
//     const newItem = new BoughtItem({
//       name,
//       cost,
//       buyer,
//       household_id: householdId
//     });
//     console.log(newItem);
//     await newItem.save();
//     await addBoughtItemToHistory(householdId, newItem);

//     // Update balances after adding the new bought item
//     await updateBalances(householdId);

//     res.status(201).json(newItem);
//   } catch (error) {
//     console.error('Error creating bought item:', error);
//     res.status(500).json({ message: 'Server error' });
//   }
// };


// module.exports = { markDebtAsPaid, confirmDebtPayment,updateBalances, getBalances, createBoughtItem };

