const User = require("../models/UserModel");
const Household = require("../models/HouseholdModel");
const BoughtItem = require("../models/BoughtItemModel");
const { addBoughtItemToHistory } = require("../utils/historyUtils");

const Debt=require("../models/DebtModel");

const updateBalances = async (householdId) => {
  try {
    const household = await Household.findById(householdId).populate('members');
    const members = household.members;

    // Initialize balance map
    const balanceMap = {};
    const payments = {};

    members.forEach(member => {
      balanceMap[member._id] = 0; // Initialize each member's balance
      payments[member._id] = 0; // Initialize each member's payments
    });

    // Fetch all bought items for the household
    const boughtItems = await BoughtItem.find({ household_id: householdId }).populate('buyer', 'username');

    // Calculate total cost
    const totalCost = boughtItems.reduce((acc, item) => acc + item.cost, 0);

    // Calculate each member's share of the total cost
    const memberCount = members.length;
    const sharePerMember = totalCost / memberCount;

    // Calculate how much each member has paid
    boughtItems.forEach(item => {
      payments[item.buyer._id] += item.cost;
    });

    // Calculate balance for each member
    members.forEach(member => {
      balanceMap[member._id] = payments[member._id] - sharePerMember;
    });

    // Calculate debts based on balances
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

      const newDebt = new Debt({
        debtor: debtor.member,
        creditor: creditor.member,
        amount: amount,
      });
      await newDebt.save();

      debtsMap[debtor.member][creditor.member] = newDebt._id;
      debtor.amount += amount;
      creditor.amount -= amount;

      if (debtor.amount === 0) {
        debtors.shift();
      }
      if (creditor.amount === 0) {
        creditors.shift();
      }
    }

    // Update each member's balance and debts
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


const settleDebt = async (req, res) => {
  const { debtId } = req.params; // Extract debtId from request parameters
  const { action } = req.body;

  try {
    const debt = await Debt.findById(debtId);
    if (!debt) {
      return res.status(404).json({ message: 'Debt not found' });
    }

    if (action === 'markAsPaid') {
      debt.paid = true;
    } else if (action === 'confirmPayment') {
      if (debt.paid) {
        debt.paidConfirmation = true;
        const debtor = await User.findById(debt.debtor);
        const creditor = await User.findById(debt.creditor);
        debtor.balance += debt.amount;
        creditor.balance -= debt.amount;
        await debtor.save();
        await creditor.save();
      } else {
        return res.status(400).json({ message: 'Debt not marked as paid' });
      }
    }
    await debt.save();
    res.status(200).json(debt);
  } catch (error) {
    console.error('Error settling debt:', error);
    res.status(500).json({ message: 'Server error' });
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
    console.log(newItem);
    await newItem.save();
    await addBoughtItemToHistory(householdId, newItem);

    // Update balances after adding the new bought item
    await updateBalances(householdId);

    res.status(201).json(newItem);
  } catch (error) {
    console.error('Error creating bought item:', error);
    res.status(500).json({ message: 'Server error' });
  }
};

module.exports = { updateBalances, getBalances, createBoughtItem, settleDebt };



//BEFORE DEBT
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

